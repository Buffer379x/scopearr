import argparse, json, os, re, socket, subprocess, sys, tempfile, threading, time, urllib.request, urllib.parse, http.cookiejar, uuid, urllib.error
parser = argparse.ArgumentParser(description='Isolated Scopearr container test with synthetic Arr/Emby APIs; no real service access.')
parser.add_argument('--image', default='scopearr:test')
parser.add_argument('--files-per-service', type=int, default=50000)
parser.add_argument('--jellyfin', action='store_true', help='Also enrich from Jellyfin and verify two enabled media servers under the same memory limit.')
parser.add_argument('--named-instances', action='store_true', help='Exercise named Arr and media-server instances, including dynamic media-match storage.')
parser.add_argument('--reprocess-cpus', type=float, help='Optional CPU limit only during rule reprocessing, to exercise slower hosts.')
args = parser.parse_args()
if args.reprocess_cpus is not None and not 0 < args.reprocess_cpus <= 2:
    parser.error('Use a reprocessing CPU limit greater than 0 and at most 2.')
if not 1 <= args.files_per_service <= 100000:
    parser.error('Use 1 to 100000 files per service.')
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from concurrent.futures import ThreadPoolExecutor
N = args.files_per_service
services = ['radarr', 'sonarr', 'emby'] + (['jellyfin'] if args.jellyfin else [])
instance_ids = {kind: kind + '-loadcheck' if args.named_instances else kind for kind in services}
arr_ids = [instance_ids[kind] for kind in ['radarr', 'sonarr']]
PER_SERIES = 50
overlap = None
env = os.environ.copy()

def docker(*args, check=True):
    return subprocess.run(['docker', *args], env=env, capture_output=True, text=True, check=check).stdout.strip()

def media_name(i, service):
    return f'{service}.{i:05d}.2020.1080p.WEB-DL.x264.mkv'

def arrfile(i, service, series=0):
    return {'id': i, 'movieId': i, 'seriesId': series, 'seasonNumber': 1, 'relativePath': media_name(i, service), 'size': 4000000000, 'quality': {'quality': {'name': 'WEBDL-1080p'}}, 'mediaInfo': {'videoCodec': 'AVC'}}

class Fixture(BaseHTTPRequestHandler):
    calls = 0
    last_request = {}

    def log_message(self, *a):
        pass

    def do_GET(self):
        Fixture.calls += 1
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        Fixture.last_request = {'path': u.path, 'item_type': q.get('IncludeItemTypes', [''])[0], 'offset': q.get('StartIndex', [''])[0]}
        if u.path == '/api/v3/movie':
            data = [{'id': i, 'title': f'Movie {i:05d}', 'year': 2020} for i in range(1, N + 1)]
        elif u.path == '/api/v3/moviefile':
            data = [arrfile(int(i), 'radarr') for i in q['movieId']]
        elif u.path == '/api/v3/series':
            data = [{'id': i, 'title': f'Series {i:05d}'} for i in range(1, (N + PER_SERIES - 1) // PER_SERIES + 1)]
        elif u.path in ['/api/v3/episodefile', '/api/v3/episode']:
            sid = int(q['seriesId'][0])
            ids = range((sid - 1) * PER_SERIES + 1, min(sid * PER_SERIES, N) + 1)
            data = [arrfile(i, 'sonarr', sid) for i in ids] if u.path.endswith('episodefile') else [{'id': i, 'episodeFileId': i, 'episodeNumber': (i - 1) % PER_SERIES + 1, 'title': f'Episode {i:05d}', 'airDate': '2020-01-01'} for i in ids]
        elif u.path in ['/emby/Items', '/Items']:
            service = 'radarr' if q['IncludeItemTypes'][0] == 'Movie' else 'sonarr'
            start = int(q['StartIndex'][0])
            limit = int(q['Limit'][0])
            itemtype = q['IncludeItemTypes'][0]
            if overlap and start + limit >= N:
                try:
                    overlap.wait(timeout=15)
                except threading.BrokenBarrierError:
                    pass
            data = {'Items': [{'Id': f'{i:032x}', 'ServerId': '0123456789abcdef0123456789abcdef', 'SeriesId': f'{((i - 1) // PER_SERIES + 1):032x}' if service == 'sonarr' else '', 'Type': itemtype, 'MediaSources': [{**({'Id': f'{i:032x}'} if args.named_instances else {}), 'Path': '/media/' + media_name(i, service), 'Size': 4000000000, 'MediaStreams': [{'Type': 'Audio', 'Index': 1, 'Codec': 'dts', 'Language': 'ger', 'Channels': 6, 'ChannelLayout': '5.1'}, {'Type': 'Audio', 'Index': 2, 'Codec': 'ac3', 'Language': 'eng', 'Channels': 6, 'ChannelLayout': '5.1'}, {'Type': 'Video', 'Index': 0, 'Codec': 'h264', 'Width': 1920, 'Height': 800, 'BitDepth': 8, 'ExtendedVideoType': 'DolbyVision', 'ExtendedVideoSubType': 'Hdr10'}]}]} for i in range(start + 1, min(start + limit, N) + 1)], 'TotalRecordCount': N}
        else:
            data = {'version': 'synthetic'}
        raw = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(raw))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass
fixture = ThreadingHTTPServer(('0.0.0.0', 0), Fixture)
threading.Thread(target=fixture.serve_forever, daemon=True).start()
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
name = 'scopearr-review-' + uuid.uuid4().hex[:10]
base = f'http://127.0.0.1:{port}'
csrf = ''
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def req(path, data=None, method=None, timeout=10):
    r = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(), method=method, headers={'Content-Type': 'application/json', 'X-CSRF-Token': csrf})
    try:
        with opener.open(r, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read(8192).decode('utf-8', errors='replace')
        raise RuntimeError(f'{r.get_method()} {path}: HTTP {error.code}: {detail}') from error
result = {'enabled_media_servers': ['emby'] + (['jellyfin'] if args.jellyfin else []), 'files_per_service': N, 'total_files': 2 * N, 'memory_limit_mib': 256, 'emby_tracks_per_file': 2, 'forced_overlap': overlap is not None, 'architecture': docker('image', 'inspect', args.image, '--format', '{{.Architecture}}'), 'runtime': 'GOMAXPROCS=2, Go memory target at most 64MiB under the 256MiB container limit'}
result.update(named_instances=args.named_instances, instance_ids=instance_ids)
# Match the host's unprivileged UID/GID so it can clean up private 0700 backup
# directories on Linux bind mounts. Root callers still run the app as 99:100.
test_uid = os.getuid() if os.getuid() else 99
test_gid = os.getgid() if os.getuid() else 100
result['container_user'] = f'{test_uid}:{test_gid}'
with tempfile.TemporaryDirectory(prefix='scopearr-review-data-') as data:
    os.chmod(data, 511)
    try:
        docker('run', '-d', '--name', name, '--user', result['container_user'], '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--memory-swap', '256m', *(['--add-host', 'host.docker.internal:host-gateway'] if sys.platform.startswith('linux') else []), '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=32m', '-p', f'127.0.0.1:{port}:8080', '-v', f'{data}:/data', args.image)
        result['memory_plus_swap_limit_mib'] = json.loads(docker('inspect', name))[0]['HostConfig']['MemorySwap'] / 1024 ** 2
        for _ in range(100):
            try:
                req('/healthz')
                break
            except Exception:
                time.sleep(0.05)
        token = docker('exec', name, 'cat', '/data/setup-token')
        req('/api/setup', {'username': 'review', 'password': 'Synthetic-review-2026', 'token': token})
        csrf = req('/api/status')['csrf']
        cfg = req('/api/settings')
        if args.named_instances:
            assert isinstance(cfg.get('instances'), list), 'Named instances require Scopearr 1.1 or newer'
            templates = {c.get('type', c['id']): c for c in cfg['instances']}
            connections = []
            for kind in services:
                connection = dict(templates[kind])
                connection.update(id=instance_ids[kind], type=kind, name=f'Load check {kind}', enabled=True, url=f'http://host.docker.internal:{fixture.server_port}', apiKey='synthetic', interval=0)
                if kind in ['emby', 'jellyfin']:
                    connection['sourceIds'] = ','.join(arr_ids)
                connections.append(connection)
            cfg['instances'] = connections
        elif isinstance(cfg.get('instances'), list):
            # Version 1.1 treats this array as canonical; legacy mirrors alone
            # must not accidentally leave every synthetic service disabled.
            for connection in cfg['instances']:
                if connection['id'] in services:
                    connection.update(enabled=True, url=f'http://host.docker.internal:{fixture.server_port}', apiKey='synthetic', interval=0)
        else:
            # Keep the default fixture usable against older release images.
            for service in services:
                cfg[service].update(enabled=True, url=f'http://host.docker.internal:{fixture.server_port}', apiKey='synthetic', interval=0)
        result['phase'] = 'synchronization'
        start = time.perf_counter()
        req('/api/settings', cfg, 'PUT')
        peak = 0
        rss_peak = 0
        status = {}
        # Poll count is not a time budget: responsive status endpoints otherwise
        # shorten this test on slower runners. Keep a bounded wall-clock limit.
        sync_deadline = time.monotonic() + 300
        while time.monotonic() < sync_deadline:
            state = json.loads(docker('inspect', name))[0]['State']
            if not state['Running']:
                result.update(completed=False, oom_killed=state['OOMKilled'], exit_code=state['ExitCode'])
                break
            raw = docker('exec', name, 'cat', '/sys/fs/cgroup/memory.peak', check=False)
            if raw.isdigit():
                peak = max(peak, int(raw))
            rss = re.search('VmRSS:\\s+(\\d+) kB', docker('exec', name, 'cat', '/proc/1/status', check=False))
            if rss:
                rss_peak = max(rss_peak, int(rss[1]) / 1024)
            try:
                reported_status = req('/api/status')['sync']
                assert all(id in reported_status for id in arr_ids), 'A configured library has no sync status'
                status = {id: reported_status[id] for id in arr_ids}
            except Exception:
                time.sleep(0.1)
                continue
            if not any((v['running'] for v in status.values())):
                result.update(completed=all((v['count'] == N and (not v['error']) for v in status.values())), statuses=status, oom_killed=False)
                break
            time.sleep(0.25)
        else:
            result.update(completed=False, statuses=status, test_error='Library synchronization exceeded its 300-second deadline')
        result.update(seconds=round(time.perf_counter() - start, 3), cgroup_peak_mib=round(peak / 1024 ** 2, 2), sampled_app_rss_peak_mib=round(rss_peak, 2))
        if result.get('completed'):
            result['phase'] = 'queries'
            timings = []
            for i in range(40):
                service = 'radarr' if i % 2 == 0 else 'sonarr'
                t = time.perf_counter()
                out = req(f'/api/files?service={service}&resolution=1080p&codec=x264')
                timings.append((time.perf_counter() - t) * 1000)
                assert out['total'] == N
                if args.named_instances:
                    assert all(file['service'] == instance_ids[service] and file['type'] == service and file['instanceName'] == f'Load check {service}' for file in out['files'])
            result['http_filter_p95_ms'] = round(sorted(timings)[37], 3)
            for endpoint in ['statistics', 'facets?service=radarr']:
                t = time.perf_counter()
                req('/api/' + endpoint)
                result[endpoint.split('?')[0] + '_cold_ms'] = round((time.perf_counter() - t) * 1000, 3)
                cached = []
                for _ in range(20):
                    t = time.perf_counter()
                    req('/api/' + endpoint)
                    cached.append((time.perf_counter() - t) * 1000)
                result[endpoint.split('?')[0] + '_cached_p95_ms'] = round(sorted(cached)[18], 3)
            # Presentation counts share one grouped trait scan, rather than one scan per tag.
            t = time.perf_counter()
            catalog = req('/api/tag-catalog')
            result['tag_catalog_ms'] = round((time.perf_counter() - t) * 1000, 3)
            assert next(row['count'] for row in catalog if row['field'] == 'resolution' and row['value'] == '1080p') == 2 * N
            cached = []
            for _ in range(20):
                t = time.perf_counter()
                assert req('/api/tag-catalog') == catalog
                cached.append((time.perf_counter() - t) * 1000)
            result['tag_catalog_cached_p95_ms'] = round(sorted(cached)[18], 3)
            # Reprocess the entire cache under the same 256 MiB/no-swap limit.
            # Verified Emby pairs must survive and no synthetic upstream GET may occur.
            result['phase'] = 'recognition reprocessing'
            current = req('/api/recognition')
            rule = {'id':'stress-source','name':'Synthetic source override','field':'source','match':'token','pattern':'WEB-DL','value':'UHD','mode':'override','priority':1,'enabled':True,'consume':False}
            before_calls = Fixture.calls
            t = time.perf_counter()
            # Sample the entire rewrite, not just the initial synchronization.
            # The unchanged cgroup/OOM gates still account for helper processes.
            sampling_done = threading.Event()
            bulk_rss = [0.0]
            def sample_bulk_rss():
                while not sampling_done.is_set():
                    try:
                        value = re.search('VmRSS:\\s+(\\d+) kB', docker('exec', name, 'cat', '/proc/1/status', check=False))
                        if value: bulk_rss[0] = max(bulk_rss[0], int(value[1])/1024)
                    except Exception:
                        pass
                    sampling_done.wait(0.25)
            sampler = threading.Thread(target=sample_bulk_rss, daemon=True)
            sampler.start()
            if args.reprocess_cpus is not None:
                docker('update', '--cpus', str(args.reprocess_cpus), name)
                result['reprocess_cpus'] = args.reprocess_cpus
            try:
                updated = req('/api/recognition', {'rules':current['rules']+[rule], 'revision':current['revision']}, 'PUT', timeout=315)
            finally:
                if args.reprocess_cpus is not None:
                    docker('update', '--cpus', '0', name)
                sampling_done.set()
                sampler.join(timeout=5)
                result['recognition_sampled_rss_peak_mib'] = round(bulk_rss[0],2)
                result['sampled_app_rss_peak_mib'] = round(max(rss_peak, bulk_rss[0]),2)
            result['recognition_reprocess_ms'] = round((time.perf_counter()-t)*1000,3)
            assert updated['revision'] != current['revision']
            assert Fixture.calls == before_calls, 'Rule save contacted an upstream service'
            for service in ['radarr','sonarr']:
                out = req(f'/api/files?service={service}&source=UHD&language=Deutsch&audio=DTS')
                assert out['total'] == N
                assert len(out['files'][0]['audioTracks']) == 2
                assert out['files'][0]['embyMatch'] == 'matched'
                assert out['files'][0]['evidence']['codec']['emby'] == 'AVC'
                assert out['files'][0]['mediaServers'][instance_ids['emby']]['video']['width'] == 1920
                if args.named_instances:
                    assert set(out['files'][0]['mediaServers']) == {instance_ids[kind] for kind in services if kind in ['emby', 'jellyfin']}
                    for match in out['files'][0]['mediaServers'].values():
                        assert match['status'] == 'matched' and match['itemType'] == ('Movie' if service == 'radarr' else 'Episode')
                        assert len(match['itemId']) == 32 and len(match['sourceId']) == 32
                        assert len(match['serverId']) == 32 and len(match['endpoint']) == 64
            result['recognition_preserved_emby'] = True
            result['recognition_upstream_requests'] = Fixture.calls - before_calls
            # Rule changes invalidate all three caches. Fill them concurrently
            # under the same memory limit and verify the new complete snapshot.
            result['phase'] = 'parallel cold reads'
            t = time.perf_counter()
            reserve_peak = 0.0
            with ThreadPoolExecutor(max_workers=3) as pool:
                futures = {key: pool.submit(req, '/api/' + path) for key, path in {
                    'statistics': 'statistics', 'facets': 'facets?service=radarr', 'catalog': 'tag-catalog'
                }.items()}
                while any(not future.done() for future in futures.values()):
                    value = re.search('VmRSS:\\s+(\\d+) kB', docker('exec', name, 'cat', '/proc/1/status', check=False))
                    if value: reserve_peak = max(reserve_peak, int(value[1]) / 1024)
                    time.sleep(0.1)
                replies = {key: future.result() for key, future in futures.items()}
            assert replies['statistics']['files'] == 2 * N
            assert 'UHD' in replies['facets']['source']
            assert next(row['count'] for row in replies['catalog'] if row['field'] == 'source' and row['value'] == 'UHD') == 2 * N
            result['parallel_cold_reads_ms'] = round((time.perf_counter() - t) * 1000, 3)
            result['parallel_sampled_app_rss_peak_mib'] = round(reserve_peak, 2)
            result['sampled_app_rss_peak_mib'] = round(max(result['sampled_app_rss_peak_mib'], reserve_peak), 2)
            result['parallel_read_reserve_passed'] = True
            raw = docker('exec', name, 'cat', '/sys/fs/cgroup/memory.peak', check=False)
            if raw.isdigit(): result['cgroup_peak_mib'] = round(int(raw)/1024**2,2)
            result['phase'] = 'complete'
            result['app_rss_after_queries_mib'] = round(int(re.search('VmRSS:\\s+(\\d+) kB', docker('exec', name, 'cat', '/proc/1/status'))[1]) / 1024, 2)
    except Exception as e:
        result['test_error'] = str(e)
    finally:
        result['fixture_last_request'] = Fixture.last_request
        result['container_state'] = json.loads(docker('inspect', name))[0]['State']
        result['oom_killed'] = result.get('oom_killed', False) or result['container_state']['OOMKilled']
        result['passed'] = bool(result.get('completed') and not result.get('test_error') and not result.get('oom_killed'))
        print(json.dumps(result, indent=2), flush=True)
        docker('rm', '-f', name, check=False)
fixture.shutdown()
if not result['passed']:
    sys.exit(1)
