# --- 0) Paramètres à adapter ---
$RepoName   = "nico-rag-api"
$GithubUser = "VOTRE_GITHUB_LOGIN"       # ex: nicolast
$UseGhCli   = $true                      # passez à $false si vous n'avez pas 'gh'

# --- 1) Vérifs de base ---
Write-Host "Vérification des fichiers..." -ForegroundColor Cyan
$required = @("server.js","package.json","package-lock.json")
$missing  = $required | Where-Object { -not (Test-Path $_) }
if ($missing) { throw "Fichiers manquants: $($missing -join ', ')" }

# Valide le JSON du package.json
try {
  Get-Content package.json -Raw | ConvertFrom-Json | Out-Null
  Write-Host "package.json: OK" -ForegroundColor Green
} catch {
  throw "package.json invalide: $($_.Exception.Message)"
}

# --- 2) .gitignore propre ---
$gitignore = @'
# Node
node_modules/
npm-debug.log*
yarn.lock
pnpm-lock.yaml

# Builds & archives
app.zip
*.zip
dist/
build/
tmp/
temp/

# Local env / secrets
.env
.local/
*.user
.venv/

# Azure/Kudu
oryx-manifest.toml
oryx*
'@
Set-Content -Path ".gitignore" -Value $gitignore -Encoding UTF8

# --- 3) README minimal ---
if (-not (Test-Path README.md)) {
  @"
# $RepoName

API Express pour Azure App Service.
- Endpoint chat vers **Azure OpenAI** (variables: `AOAI_ENDPOINT`, `AOAI_KEY`, `AOAI_DEPLOYMENT`)
- OBO Graph via **MSAL** (variables: `TENANT_ID`, `API_CLIENT_ID`, `API_CLIENT_SECRET`)
- Démarrage local: `npm install` puis `npm start`

"@ | Set-Content README.md -Encoding UTF8
}

# --- 4) Init Git ---
if (-not (Test-Path ".git")) {
  git init
  git checkout -b main
  git config user.name  "$env:USERNAME"
  git config user.email "you@example.com"   # mettez votre email Git
}

git add .
git commit -m "chore: initial commit (api + package files)"

# --- 5) Création du repo GitHub + push ---
if ($UseGhCli -and (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "Création du repo GitHub avec gh..." -ForegroundColor Cyan
  # Authentifiez-vous si besoin: gh auth login
  gh repo create "$GithubUser/$RepoName" --public --source "." --remote "origin" --push
} else {
  Write-Host "gh non disponible : création manuelle du remote..." -ForegroundColor Yellow
  $remote = "https://github.com/$GithubUser/$RepoName.git"
  if (-not (git remote 2>$null | Select-String -SimpleMatch "origin")) {
    git remote add origin $remote
  }
  git push -f origin main
}

Write-Host "✅ Dépôt poussé sur GitHub." -ForegroundColor Green
