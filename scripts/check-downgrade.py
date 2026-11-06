"""Check that data written by one Scopearr image still starts an older release.

The new image creates a fresh data directory and saves settings. The previous
image then starts on the same directory and must sign in, keep the saved
interface settings and serve the main read endpoints. Exit 0 means the
downgrade works; exit 1 prints the reason and both containers' logs to stderr.
"""
import argparse
import http.cookiejar
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from typing import Callable

COMPARED_KEYS = ("interfaceTheme", "widgets", "columnOrder", "visibleColumns", "listInfoOrder", "listInfoVisible", "placementColumnOrder", "placementVisibleColumns", "filecheckColumnOrder", "filecheckVisibleColumns")
USERNAME = 'downgrade'
PASSWORD = 'Downgrade-check-2026'
PREFIX = 'scopearr-downgrade'
START_TIMEOUT = 60


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

    def req(self, path, data=None, method=None, timeout=10):
        r = urllib.request.Request(self.base + path, data=None if data is None else json.dumps(data).encode(), method=method, headers={'Content-Type': 'application/json', 'X-CSRF-Token': self.csrf})
        try:
            with self.opener.open(r, timeout=timeout) as response:
                if response.status != 200:
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


def start(name, image, data, port):
    docker('run', '-d', '--name', name, '--user', container_user(), '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--memory-swap', '512m', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=32m', '-p', f'127.0.0.1:{port}:8080', '-v', f'{data}:/data', image)
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
        print(f'Downgrade to {args.previous}: ok')
        return 0
    except Exception as error:
        print(f'Downgrade to {args.previous}: failed: {error}', file=sys.stderr)
        for name in (new, old):
            text = logs[name] if name in logs else docker_logs(name)
            print(f'--- docker logs {name} ---\n{text}', file=sys.stderr)
        return 1
    finally:
        remove_containers(run)
        shutil.rmtree(data, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
