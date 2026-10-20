# Unraid installation

Use the public release image and the included XML template. Existing installations update through Unraid’s normal container update action.

1. Save `deploy/scopearr.xml` as `my-scopearr.xml` under `/boot/config/plugins/dockerMan/templates-user/`.
2. Select Docker → Add Container → template `scopearr`.
3. Use repository `ghcr.io/buffer379x/scopearr:stable`, keep Privileged off, and select Shell `sh`. With Bridge, choose a free host port. With an existing custom Docker VLAN, choose that network and a reserved fixed IP; port 8080 is reachable directly on that IP.
4. Mount `/data` at a local SSD/NVMe pool path such as `/mnt/cache/appdata/scopearr`. Adjust the pool name. For library exploration, add no media directories. Optional track editing requires a read-write media mount outside `/data`; see [MKVToolNix](MUX.md). Before first start, create the directory and set ownership/mode for the container: `mkdir -p /mnt/cache/appdata/scopearr`, `chown 99:100 /mnt/cache/appdata/scopearr`, `chmod 700 /mnt/cache/appdata/scopearr`.
5. Extra Parameters: `--user=99:100 --read-only --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m --cap-drop=ALL --security-opt=no-new-privileges --memory=256m`. Match the directory owner when changing UID/GID. PUID/PGID environment variables are not used; there is no root entrypoint.
6. Apply and open WebUI. Read `cat /data/setup-token` in the container console, then enter the code and new credentials yourself in the interface.
7. In Settings → Services, enter/test/enable/save Radarr and Sonarr URLs and API keys. Optionally connect Emby. Keys are located under Settings → General in Arr services and Dashboard → API keys in Emby. Wait for the initial complete sync.
8. Enable Autostart. Choose the interface language on login or under Settings → Display.

Updates: Docker → Check for Updates → Scopearr → Update. The existing `/data` is reused; required schema migrations create a consistent database snapshot first. Version 0.3.0 upgrades SQLite to schema 5 with an automatic backup. A rollback to 0.2.3 also requires its matching pre-migration database snapshot.

A dedicated container IP does not need host port mapping. Ensure the container can reach its services through your VLAN/firewall rules. Without HTTPS, keep `SCOPEARR_HTTPS=false`; with an existing HTTPS proxy, set it to true. The template does not set up public Internet exposure. A swap-limit warning means the host cannot enforce that additional limit; it does not remove the RAM limit.

If pulling reports access denied, verify that the GHCR package is Public, independently of repository visibility. See [operations](OPERATIONS.md) for backup and recovery.


The template uses a 256 MiB RAM limit without requesting an unsupported swap-accounting limit. Existing Unraid container parameters are stored separately: an image update does not replace Extra Parameters. If your host reports the swap-limit warning, remove only `--memory-swap=256m` from that field when editing the container, retaining `--memory=256m` and the other restrictions. Hosts supporting swap accounting may retain the stricter flag. Docker Compose and automated tests continue to set memory-plus-swap to 256 MiB. See [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).

When enabling MKVToolNix, change Extra Parameters to `--memory=512m` (and `--memory-swap=512m` if set), add the optional `/media` mount manually, and grant UID 99/GID 100 write access. Existing installations do not inherit template changes.
