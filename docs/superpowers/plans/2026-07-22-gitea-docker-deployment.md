# Gitea Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy VaM Backstage automatically on the existing Gitea Docker runner whenever `develop` is pushed.

**Architecture:** One Gitea Actions workflow follows the existing PML/ERP checkout-and-Compose pattern. Ubuntu owns the VaM root and common storage SMB mounts and credentials; the runner supplies their host paths and the image's storage symlink target. The same `develop` commit is pushed to Gitea and GitHub.

**Tech Stack:** Gitea Actions, Docker Compose, YAML, Git, PowerShell

## Global Constraints

- Trigger deployment only from `develop`.
- Use the existing `ubuntu-latest` self-hosted runner.
- Default the root and common storage mounts to `/mnt/vam-root` and `/mnt/vam-storage`.
- Mount common storage once at `/vam-storage` and link `/??/D:/games/vam` to it inside the image, matching the Windows symlink target exposed by CIFS.
- Keep SMB credentials out of Git, Gitea variables, and the container.
- Do not add a registry, staging environment, authentication, or new application code.

---

### Task 1: Add the deployment workflow

**Files:**

- Create: `.gitea/workflows/deploy-server.yaml`

**Interfaces:**

- Consumes: existing `docker-compose.yml` and optional Gitea mount-path variables
- Produces: a push-triggered Compose deployment for branch `develop`

- [ ] **Step 1: Confirm the workflow does not exist**

Run:

```powershell
Test-Path -LiteralPath .gitea/workflows/deploy-server.yaml
```

Expected: `False`.

- [ ] **Step 2: Create the minimal workflow**

```yaml
name: Deploy VaM Backstage

on:
  push:
    branches: ['develop']

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Connecting to Gitea
        run: git config --global url."http://oboro.local:6080/".insteadOf "http://gitea:3000/"

      - name: Checkout code
        uses: actions/checkout@v4

      - name: Deploy via Docker Compose
        run: |
          cat > .env << 'EOF'
          VAM_ROOT_MOUNT=${{ vars.VAM_ROOT_MOUNT || '/mnt/vam-root' }}
          VAM_STORAGE_MOUNT=${{ vars.VAM_STORAGE_MOUNT || '/mnt/vam-storage' }}
          VAM_STORAGE_TARGET=${{ vars.VAM_STORAGE_TARGET || '/??/D:/games/vam' }}
          EOF
          docker compose up -d --build
```

- [ ] **Step 3: Validate YAML and required values**

Run:

```powershell
node -e "const fs=require('fs'); const YAML=require('yaml'); const x=YAML.parse(fs.readFileSync('.gitea/workflows/deploy-server.yaml','utf8')); if(x.on.push.branches[0]!=='develop'||x.jobs.deploy['runs-on']!=='ubuntu-latest') process.exit(1); console.log('workflow ok')"
```

Expected: `workflow ok`.

- [ ] **Step 4: Commit**

```powershell
git add -- .gitea/workflows/deploy-server.yaml
git commit -m "ci: deploy Docker server from Gitea"
```

### Task 2: Create and publish the Gitea repository

**Files:**

- Modify: local Git configuration only (`gitea` remote)

**Interfaces:**

- Consumes: existing Windows Git credential for `oboro.local:6080`
- Produces: public `gitea/vam-backstage` repository with `develop` as its deployment branch

- [ ] **Step 1: Create the repository through the authenticated API**

Use `git credential fill` inside PowerShell, parse it in memory, send Basic authentication to `POST /api/v1/user/repos`, and print only the new repository name and clone URL. Never print the credential response, username/password pair, or Authorization header.

Request body:

```json
{
  "name": "vam-backstage",
  "description": "VaM Backstage intranet deployment",
  "private": false,
  "auto_init": false,
  "default_branch": "develop"
}
```

Expected: repository `gitea/vam-backstage` created.

- [ ] **Step 2: Add the remote**

```powershell
git remote add gitea http://gitea@oboro.local:6080/gitea/vam-backstage.git
git remote get-url gitea
```

Expected: `http://gitea@oboro.local:6080/gitea/vam-backstage.git`.

- [ ] **Step 3: Push the deployment branch**

```powershell
git push -u gitea develop
```

Expected: new `develop` branch and Gitea Actions run triggered.

### Task 3: Verify deployment and synchronize GitHub

**Files:**

- None

**Interfaces:**

- Consumes: Gitea Actions run and deployed ports 42069/42070
- Produces: verified live deployment and matching Gitea/GitHub `develop` heads

- [ ] **Step 1: Confirm the action succeeds**

Query `GET /api/v1/repos/gitea/vam-backstage/actions/runs` with the credential kept in memory. Wait for the newest run for `develop` to reach `success`; report its run number and commit SHA. If it fails, inspect that run's jobs/logs before changing files.

- [ ] **Step 2: Confirm deployed services**

```powershell
(Invoke-WebRequest -Uri 'http://oboro.local:42069/' -UseBasicParsing).StatusCode
Test-NetConnection oboro.local -Port 42070 -InformationLevel Quiet
```

Expected: HTTP `200`, then `True`.

- [ ] **Step 3: Push GitHub and verify both heads**

```powershell
git push origin develop
git ls-remote gitea refs/heads/develop
git ls-remote origin refs/heads/develop
git status --short --branch
```

Expected: both remote hashes equal local `HEAD`; clean `develop` branch.
