# Gitea Docker Deployment Design

## Goal

Deploy the existing VaM Backstage Docker Compose service automatically from the local Gitea runner whenever `develop` is pushed.

## Design

Create a public `gitea/vam-backstage` repository on the existing intranet Gitea instance and add it as the local `gitea` remote. GitHub `origin`, upstream routing, and the protected `master` workflow remain unchanged.

Add one workflow at `.gitea/workflows/deploy-server.yaml`, matching PML and ERP:

1. Trigger only on pushes to `develop`.
2. Rewrite the checkout URL from `http://gitea:3000/` to `http://oboro.local:6080/` for the self-hosted `ubuntu-latest` runner.
3. Check out the pushed revision with `actions/checkout@v4`.
4. Write `.env` with `VAM_MOUNT=${{ vars.VAM_MOUNT || '/mnt/vam' }}`.
5. Run `docker compose up -d --build`.

SMB credentials stay in Ubuntu `/etc/fstab` and its root-readable credentials file. They are not Gitea variables or secrets. The existing Compose defaults, ports, volume, restart policy, image, and application behavior remain unchanged.

## Verification

- Validate the workflow YAML and Compose substitution locally.
- Push `develop` to the new Gitea remote.
- Confirm the Gitea action completes successfully.
- Confirm the deployed browser endpoint responds on port 42069 and the Hub proxy port 42070 is reachable.
- Confirm the Gitea `develop` head matches the local commit.

## Excluded

- Container registry publishing.
- Deployment from GitHub Actions.
- Production/staging environments.
- SMB mounting inside the container.
- Authentication or internet exposure.
