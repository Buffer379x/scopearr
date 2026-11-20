"""Check that data written by one Scopearr image still starts an older release.

Two scenarios run one after the other, each on its own data directory:

settings: the new image creates a fresh data directory and saves settings. The
previous image then starts on the same directory and must sign in, keep the
saved interface settings and serve the main read endpoints.

demo: the new image starts with SCOPEARR_DEMO=true and adds the 2.0.0 default
rules and the audio track index. A track filter and a preset saved with it
must match the files expected from the demo data. The previous image then
starts in demo mode on the same directory; its demo seed rewrites every file,
so its writes run through the index triggers. It must keep the rules, answer
the track filter with HTTP 200 (it ignores the parameter and returns more
files) and log no SQLite error. The new image starts once more without demo
mode, so it does not rewrite the files itself: the rules must be unchanged and
not doubled, and the track filter and the preset must return the same files as
before. Finally a trigger is dropped and the index emptied, so the new image
must rebuild and refill it; the rebuilt rows must equal the rows the triggers
wrote.

Exit 0 means the downgrade works; exit 1 prints the reason and all containers'
logs to stderr.
"""
import argparse
import http.cookiejar
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Callable

COMPARED_KEYS = ("interfaceTheme", "widgets", "columnOrder", "visibleColumns", "listInfoOrder", "listInfoVisible", "placementColumnOrder", "placementVisibleColumns", "filecheckColumnOrder", "filecheckVisibleColumns")
USERNAME = 'downgrade'
PASSWORD = 'Downgrade-check-2026'
PREFIX = 'scopearr-downgrade'
START_TIMEOUT = 60
DEMO_USERNAME = 'demo'
DEMO_PASSWORD = 'Scopearr-demo-2026'
DEMO_ENV = ('SCOPEARR_DEMO=true',)
DEFAULT_RULE_IDS_200 = ("default-hdr-sdr", "default-channels-1-0", "default-channels-6-1")
INDEX_TRIGGER = 'file_audio_tracks_update_v1'
SQLITE_ERROR_MARKERS = ('sql logic error', 'constraint failed', 'malformed', 'database is locked', 'database disk image', 'no such table', 'no such column', 'foreign key mismatch')


def wait_healthy(probe: Callable[[], bool], running: Callable[[], bool], timeout: float, interval: float = 0.25) -> None:
    """Return once probe() succeeds; fail fast if the container stops running."""
    deadline = time.monotonic() + timeout
    while True:
        if probe():
            return
        if not running():
            raise RuntimeError('container exited')
        if time.monotonic() >= deadline:
            raise TimeoutError(f'not healthy after {timeout:g}s')
        time.sleep(interval)


def settings_problems(saved: dict, reread: dict) -> list[str]:
    """List the compared settings that differ or disappeared after the downgrade."""
    problems = []
    for key in COMPARED_KEYS:
        if (key in saved) != (key in reread) or saved.get(key) != reread.get(key):
            problems.append(f'{key} changed after downgrade')
    return problems


def rule_problems(rules: list[dict]) -> list[str]:
    """Report each 2.0.0 default rule that is missing or appears more than once."""
    problems = []
    for rule_id in DEFAULT_RULE_IDS_200:
        count = sum(1 for rule in rules if rule.get('id') == rule_id)
        if count == 0:
            problems.append(f'{rule_id} is missing')
        elif count > 1:
            problems.append(f'{rule_id} appears {count} times')
    return problems


def default_rules(rules: list[dict]) -> dict:
    return {rule['id']: rule for rule in rules if rule.get('id') in DEFAULT_RULE_IDS_200}


def track_value(language: str, codec: str, channels: str) -> str:
    """Build a track filter value: language|codec|channels, empty = any."""
    parts = (language, codec, channels)
    if any('|' in part for part in parts):
        raise ValueError(f'track filter parts must not contain "|": {parts!r}')
    return '|'.join(parts)


def tracks_of(item: dict) -> list[dict]:
    return [track for track in item.get('audioTracks') or [] if isinstance(track, dict)]


def combination_probe(items: list[dict]) -> tuple[int, str, str]:
    """Pick a file with two tracks that differ in language and codec.

    Returns the file id, a value matching its first track (language and codec of
    the same track) and a crossed value (first language, other codec) that no
    track of the file has.
    """
    for item in items:
        tracks = tracks_of(item)
        if len(tracks) < 2:
            continue
        language, codec = tracks[0].get('language') or '', tracks[0].get('codec') or ''
        if not language or not codec:
            continue
        pairs = {(track.get('language') or '', track.get('codec') or '') for track in tracks}
        for other in tracks[1:]:
            other_language, other_codec = other.get('language') or '', other.get('codec') or ''
            if other_language and other_codec and other_language != language and other_codec != codec and (language, other_codec) not in pairs:
                return item['id'], track_value(language, codec, ''), track_value(language, other_codec, '')
    raise RuntimeError('no file has two audio tracks that differ in language and codec')


def track_matches(items: list[dict], language: str, codec: str) -> set[int]:
    """Ids of the files with one track that has both language and codec."""
    return {item['id'] for item in items if any(track.get('language') == language and track.get('codec') == codec for track in tracks_of(item))}


def sqlite_log_problems(text: str) -> list[str]:
    """Log lines that report a SQLite error."""
    return [line for line in text.splitlines() if any(marker in line.lower() for marker in SQLITE_ERROR_MARKERS)]


def container_name(prefix: str) -> str:
    return f'{prefix}-{uuid.uuid4().hex[:8]}'


def docker(*args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'docker {args[0]} failed: {result.stderr.strip() or result.stdout.strip()}')
    return result.stdout.strip()


def docker_logs(name):
    result = subprocess.run(['docker', 'logs', name], capture_output=True, text=True)
    return (result.stdout + result.stderr).strip()


def container_log(logs, name):
    """The saved log of a stopped container (even an empty one); otherwise fetch it."""
    text = logs.get(name)
    return docker_logs(name) if text is None else text


def is_running(name):
    try:
        return docker('inspect', '-f', '{{.State.Running}}', name) == 'true'
    except RuntimeError:
        return False


def container_user():
    # Match the host's unprivileged UID/GID so the bind-mounted data stays
    # removable; root callers still run the app as 99:100.
    uid = os.getuid()
    return f'{uid}:{os.getgid()}' if uid else '99:100'


class Client:
    def __init__(self, port):
        self.base = f'http://127.0.0.1:{port}'
        self.csrf = ''
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def req(self, path, data=None, method=None, timeout=10, expect=200):
        r = urllib.request.Request(self.base + path, data=None if data is None else json.dumps(data).encode(), method=method, headers={'Content-Type': 'application/json', 'X-CSRF-Token': self.csrf})
        try:
            with self.opener.open(r, timeout=timeout) as response:
                if response.status != expect:
                    raise RuntimeError(f'{r.get_method()} {path}: HTTP {response.status}')
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read(8192).decode('utf-8', errors='replace')
            raise RuntimeError(f'{r.get_method()} {path}: HTTP {error.code}: {detail}') from error

    def healthy(self):
        try:
            self.req('/healthz', timeout=2)
            return True
        except Exception:
            return False


def start(name, image, data, port, env=(), logs=None):
    if logs is not None:
        logs[name] = None  # started: print its logs on failure
    environment = [arg for value in env for arg in ('-e', value)]
    docker('run', '-d', '--name', name, '--user', container_user(), '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--memory-swap', '512m', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=32m', '-p', f'127.0.0.1:{port}:8080', '-v', f'{data}:/data', *environment, image)
    client = Client(port)
    try:
        wait_healthy(client.healthy, lambda: is_running(name), START_TIMEOUT)
    except (RuntimeError, TimeoutError) as error:
        raise RuntimeError(f'{image}: {error}') from error
    return client


def write_with_new(name, image, data, port, logs):
    client = start(name, image, data, port)
    token = docker('exec', name, 'cat', '/data/setup-token')
    client.req('/api/setup', {'username': USERNAME, 'password': PASSWORD, 'token': token})
    client.csrf = client.req('/api/status')['csrf']
    cfg = client.req('/api/settings')
    cfg['interfaceTheme'] = 'nord'
    client.req('/api/settings', cfg, 'PUT')
    saved = client.req('/api/settings')
    if saved.get('interfaceTheme') != 'nord':
        raise RuntimeError(f'{image}: interfaceTheme was not saved')
    client.req('/api/recognition')
    docker('stop', name)
    logs[name] = docker_logs(name)
    docker('rm', name)
    return saved


def read_with_previous(name, image, data, port, saved):
    client = start(name, image, data, port)
    client.req('/api/login', {'username': USERNAME, 'password': PASSWORD, 'token': ''})
    client.csrf = client.req('/api/status')['csrf']
    problems = settings_problems(saved, client.req('/api/settings'))
    if problems:
        raise RuntimeError(f'{image}: ' + '; '.join(problems))
    client.req('/api/recognition')
    client.req('/api/files?service=radarr&page=1')


def finish(name, logs):
    """Stop a container, keep its logs and remove it."""
    docker('stop', name)
    logs[name] = docker_logs(name)
    docker('rm', name)
    return logs[name]


def sign_in(client, username, password):
    client.req('/api/login', {'username': username, 'password': password, 'token': ''})
    client.csrf = client.req('/api/status')['csrf']


def file_ids(client, query):
    """Ids of the radarr files that match query; all must fit on the first page."""
    page = client.req('/api/files?service=radarr&page=1' + query)
    ids = {item['id'] for item in page['files']}
    if page['total'] != len(ids):
        raise RuntimeError(f'files{query}: {page["total"]} matches do not fit on one page')
    return ids, page


def has_preset(client, preset):
    return any(saved.get('id') == preset['id'] and saved.get('query') == preset['query'] for saved in client.req('/api/presets'))


def track_query(value):
    return '&track=' + urllib.parse.quote(value, safe='')


def read_store(data, query):
    """Run a read query on a copy of the stopped container's database."""
    with tempfile.TemporaryDirectory(prefix='scopearr-downgrade-db-') as copy:
        for suffix in ('', '-wal', '-shm'):
            source = os.path.join(data, 'scopearr.db' + suffix)
            if os.path.exists(source):
                shutil.copyfile(source, os.path.join(copy, 'scopearr.db' + suffix))
        connection = sqlite3.connect(os.path.join(copy, 'scopearr.db'))
        try:
            return connection.execute(query).fetchall()
        finally:
            connection.close()


def radarr_rowids(data):
    return {row[0] for row in read_store(data, "SELECT rowid FROM files WHERE service='radarr'")}


def index_rows(data):
    return sorted(read_store(data, 'SELECT file_rowid,position,language,codec,channels FROM file_audio_tracks'))


def index_trigger_present(data):
    return read_store(data, f"SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name='{INDEX_TRIGGER}'") == [(1,)]


def drop_index_trigger(data):
    """Drop one index trigger and empty the index, so the next start of the new
    image must rebuild and refill it."""
    path = os.path.join(data, 'scopearr.db')
    connection = sqlite3.connect(path)
    try:
        connection.execute(f'DROP TRIGGER {INDEX_TRIGGER}')
        connection.execute('DELETE FROM file_audio_tracks')
        connection.commit()
    finally:
        connection.close()
    if os.getuid() == 0:
        uid, gid = (int(part) for part in container_user().split(':'))
        for name in os.listdir(data):
            os.chown(os.path.join(data, name), uid, gid)


def check_logs(image, text):
    problems = sqlite_log_problems(text)
    if problems:
        raise RuntimeError(f'{image}: SQLite errors in the log: ' + ' | '.join(problems))


def check_demo(args, run, logs) -> None:
    """Demo scenario: default rules and the audio track index survive the previous release."""
    new, old, back, rebuild = (f'{run}-demo-{step}' for step in ('new', 'old', 'back', 'rebuild'))
    data = tempfile.mkdtemp(prefix='scopearr-downgrade-demo-')
    try:
        os.chmod(data, 0o777)
        print(f'Demo: writing default rules and the track index with {args.image}', flush=True)
        client = start(new, args.image, data, args.port, env=DEMO_ENV, logs=logs)
        sign_in(client, DEMO_USERNAME, DEMO_PASSWORD)
        rules = client.req('/api/recognition')['rules']
        problems = rule_problems(rules)
        if problems:
            raise RuntimeError(f'{args.image}: ' + '; '.join(problems))
        saved_rules = default_rules(rules)
        all_ids, page = file_ids(client, '')
        probe, matching, crossed = combination_probe(page['files'])
        language, codec, _ = matching.split('|')
        expected = track_matches(page['files'], language, codec)
        matched, _ = file_ids(client, track_query(matching))
        if probe not in matched or matched != expected:
            raise RuntimeError(f'{args.image}: track={matching} returned {sorted(matched)}, expected {sorted(expected)}')
        if probe in file_ids(client, track_query(crossed))[0]:
            raise RuntimeError(f'{args.image}: track={crossed} matched file {probe}')
        preset_query = 'track=' + urllib.parse.quote(matching, safe='')
        preset = client.req('/api/presets', {'name': 'Downgrade track preset', 'service': 'radarr', 'query': preset_query}, 'POST', expect=201)
        if file_ids(client, '&' + preset['query'])[0] != matched:
            raise RuntimeError(f'{args.image}: preset {preset["query"]} does not filter like track={matching}')
        finish(new, logs)
        check_logs(args.image, logs[new])
        written, written_files = index_rows(data), radarr_rowids(data)
        if not written:
            raise RuntimeError(f'{args.image}: the track index is empty')
        print(f'Demo: track={matching} matches {len(matched)} of {len(all_ids)} files; the index has {len(written)} rows', flush=True)

        print(f'Demo: starting {args.previous} in demo mode on the same data', flush=True)
        client = start(old, args.previous, data, args.port, env=DEMO_ENV, logs=logs)
        sign_in(client, DEMO_USERNAME, DEMO_PASSWORD)
        rules = client.req('/api/recognition')['rules']
        problems = rule_problems(rules)
        if problems:
            raise RuntimeError(f'{args.previous}: ' + '; '.join(problems))
        if default_rules(rules) != saved_rules:
            raise RuntimeError(f'{args.previous}: the 2.0.0 default rules changed')
        client.req('/api/settings')
        ignored, _ = file_ids(client, track_query(matching))
        if ignored != all_ids or len(ignored) <= len(matched):
            raise RuntimeError(f'{args.previous}: track={matching} returned {len(ignored)} files, expected all {len(all_ids)}')
        if file_ids(client, '&' + preset['query'])[0] != all_ids:
            raise RuntimeError(f'{args.previous}: preset {preset["query"]} did not return all files')
        if not has_preset(client, preset):
            raise RuntimeError(f'{args.previous}: preset {preset["query"]} is missing')
        finish(old, logs)
        check_logs(args.previous, logs[old])
        rewritten, rewritten_files = index_rows(data), radarr_rowids(data)
        if not rewritten_files or rewritten_files & written_files:
            raise RuntimeError(f'{args.previous}: the demo seed did not rewrite the files, so no write ran through the index triggers')
        print(f'Demo: {args.previous} ignored track and returned {len(ignored)} files; its writes left {len(rewritten)} index rows', flush=True)

        print(f'Demo: starting {args.image} again without demo mode', flush=True)
        client = start(back, args.image, data, args.port, logs=logs)
        sign_in(client, DEMO_USERNAME, DEMO_PASSWORD)
        rules = client.req('/api/recognition')['rules']
        problems = rule_problems(rules)
        if problems:
            raise RuntimeError(f'{args.image} after {args.previous}: ' + '; '.join(problems))
        if default_rules(rules) != saved_rules:
            raise RuntimeError(f'{args.image} after {args.previous}: the 2.0.0 default rules changed')
        again, _ = file_ids(client, track_query(matching))
        if again != matched:
            raise RuntimeError(f'{args.image} after {args.previous}: track={matching} returned {sorted(again)}, expected {sorted(matched)}')
        if probe in file_ids(client, track_query(crossed))[0]:
            raise RuntimeError(f'{args.image} after {args.previous}: track={crossed} matched file {probe}')
        if not has_preset(client, preset) or file_ids(client, '&' + preset['query'])[0] != matched:
            raise RuntimeError(f'{args.image} after {args.previous}: preset {preset["query"]} does not filter like track={matching}')
        finish(back, logs)
        check_logs(args.image, logs[back])
        if index_rows(data) != rewritten:
            raise RuntimeError(f'{args.image} after {args.previous}: the track index changed without a write')

        drop_index_trigger(data)
        start(rebuild, args.image, data, args.port, logs=logs)
        finish(rebuild, logs)
        check_logs(args.image, logs[rebuild])
        rebuilt = index_rows(data)
        if not index_trigger_present(data):
            raise RuntimeError(f'{args.image}: the start did not rebuild the track index after {INDEX_TRIGGER} was dropped')
        if rebuilt != rewritten:
            only_written = sorted(set(rewritten) - set(rebuilt))[:3]
            only_rebuilt = sorted(set(rebuilt) - set(rewritten))[:3]
            raise RuntimeError(f'{args.previous} left {len(rewritten)} index rows, a rebuild has {len(rebuilt)}: only written {only_written}, only rebuilt {only_rebuilt}')
        print(f'Demo: a rebuild gives the same {len(rebuilt)} index rows', flush=True)
    finally:
        shutil.rmtree(data, ignore_errors=True)


def remove_containers(run):
    names = subprocess.run(['docker', 'ps', '-a', '--format', '{{.Names}}'], capture_output=True, text=True).stdout.split()
    leftovers = [name for name in names if name.startswith(run + '-')]
    if leftovers:
        subprocess.run(['docker', 'rm', '-f', *leftovers], capture_output=True, text=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Check that data written by --image still starts the --previous Scopearr release.')
    parser.add_argument('--image', required=True, help='Image under test, for example scopearr:test.')
    parser.add_argument('--previous', required=True, help='Older release image that must still start on the same data.')
    parser.add_argument('--port', type=int, default=18090, help='Local port for the API (default: 18090).')
    args = parser.parse_args(argv)
    run = container_name(PREFIX)
    new, old = f'{run}-new', f'{run}-old'
    logs = {}
    data = tempfile.mkdtemp(prefix='scopearr-downgrade-data-')
    try:
        os.chmod(data, 0o777)
        print(f'Writing data with {args.image}', flush=True)
        saved = write_with_new(new, args.image, data, args.port, logs)
        print(f'Starting {args.previous} on the same data', flush=True)
        read_with_previous(old, args.previous, data, args.port, saved)
        finish(old, logs)
        check_demo(args, run, logs)
        print(f'Downgrade to {args.previous}: ok')
        return 0
    except Exception as error:
        print(f'Downgrade to {args.previous}: failed: {error}', file=sys.stderr)
        for name in dict.fromkeys([new, old, *logs]):
            text = container_log(logs, name)
            print(f'--- docker logs {name} ---\n{text}', file=sys.stderr)
        return 1
    finally:
        remove_containers(run)
        shutil.rmtree(data, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
