# Docker hosting with a Windows VaM share

This setup runs VaM Backstage on an Ubuntu intranet server while the complete VaM folder remains on a Windows machine. Ubuntu mounts the Windows share with SMB, then Docker bind-mounts it at `/vam`. Backstage keeps its database and settings in a persistent Docker volume at `/data`.

The browser server has no authentication. Use this only on a trusted LAN and do not expose ports 42069 or 42070 to the internet.

## 1. Share the VaM folder from Windows

Share the complete VaM folder with a dedicated Windows account. Give that account read and write access in both the share permissions and the folder's NTFS permissions.

Record:

- Windows host name or IP, such as `GAMING-PC`
- Share name, such as `VaM`
- Dedicated account username and password

The share root must contain `AddonPackages`, `Custom`, and `Saves`.

## 2. Mount the share on Ubuntu

Install CIFS support and create the mount point:

```bash
sudo apt update
sudo apt install -y cifs-utils
sudo mkdir -p /mnt/vam
```

Create `/etc/samba/vam-backstage.credentials`:

```text
username=WINDOWS_USER
password=WINDOWS_PASSWORD
domain=WORKGROUP
```

Protect it:

```bash
sudo chmod 600 /etc/samba/vam-backstage.credentials
```

Add this single line to `/etc/fstab`, replacing the host and share names:

```fstab
//WINDOWS_HOST/VAM_SHARE /mnt/vam cifs credentials=/etc/samba/vam-backstage.credentials,uid=1000,gid=1000,file_mode=0664,dir_mode=0775,vers=3.0,_netdev,nofail,x-systemd.automount 0 0
```

The container runs as UID/GID 1000. If UID 1000 is unsuitable on the Ubuntu host, change both IDs in the Docker image and the mount options together.

Activate and verify the mount:

```bash
sudo systemctl daemon-reload
sudo mount /mnt/vam
findmnt /mnt/vam
test -d /mnt/vam/AddonPackages
test -d /mnt/vam/Custom
test -d /mnt/vam/Saves
touch /mnt/vam/.vam-backstage-write-test
rm /mnt/vam/.vam-backstage-write-test
```

Do not start Backstage until all commands succeed.

## 3. Start Backstage

Install Docker Engine with the Compose plugin, clone this repository, and run from the repository root:

```bash
docker compose up -d --build
docker compose logs -f backstage
```

Open `http://UBUNTU_HOST:42069` from a desktop browser. Keep both TCP ports reachable on the LAN:

- `42069`: browser app and WebSocket RPC
- `42070`: Hub proxy

The default deployment uses:

- `/mnt/vam` on Ubuntu -> `/vam` in the container, read/write
- Docker volume `backstage-data` -> `/data` in the container
- manual storage mode, so the server does not depend on filesystem watcher events from SMB

## 4. Refresh and recover

Use the compact **Rescan** button in the status bar after files change outside Backstage. It appears only in browser/server manual-storage mode. The same manual-rescan note appears beside the scan controls in Settings.

If the Windows share becomes unavailable, Backstage blocks library operations and shows the failed path and error. Restore the SMB share, verify `findmnt /mnt/vam`, then select **Retry**. Recovery checks storage, runs a scan, and checks storage again.

If `/mnt/vam` was unmounted and mounted again while the container stayed running, restart the service before retrying so Docker sees the restored mount:

```bash
docker compose restart backstage
```

This POC intentionally has no offline cache. The UI remains blocked until the shared VaM folder is available again.

## 5. Operations

```bash
docker compose ps
docker compose logs --tail=200 backstage
docker compose restart backstage
docker compose down
```

`docker compose down` preserves the database volume. Do not use `docker compose down -v` unless you intend to delete Backstage's server database and settings.

Back up `/data` before upgrades:

```bash
mkdir -p backups
docker compose stop backstage
docker compose run --rm --no-deps -v "$PWD/backups:/backup" --entrypoint sh backstage -c 'tar -czf /backup/backstage-data-$(date +%F).tgz -C /data .'
docker compose start backstage
```

Keep the SMB credentials only in `/etc/samba/vam-backstage.credentials` on Ubuntu. Never add them to this repository or Compose configuration.
