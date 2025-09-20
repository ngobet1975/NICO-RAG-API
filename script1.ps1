# === Paramètres ===
$RepoUrl  = "https://github.com/ngobet1975/NICO-RAG-API.git"
$Branch   = "main"
$WorkDir  = "C:\ChatBOTIA\chat2"

# === Go ===
Set-Location $WorkDir

# Identité (au cas où)
git config user.name  "ngobet1975" | Out-Null
git config user.email "nicolas@itsynchronic.com" | Out-Null

# Init / Remote propre
git init | Out-Null
git remote remove origin 2>$null
git remote add origin $RepoUrl

# .gitignore minimal (créé s’il n’existe pas)
if (!(Test-Path .gitignore)) {
@"
node_modules/
npm-debug.log*
*.log
.env
app.zip
publishProfile*.xml
.DS_Store
Thumbs.db
"@ | Set-Content .gitignore -Encoding UTF8
}

# S’assurer d’être sur la bonne branche et committer tout
git checkout -B $Branch | Out-Null
git add -A
git commit -m "chore: force update backend (server.js, package.json, lock, .gitignore)" --allow-empty | Out-Null

# Tenter un fetch pour activer --force-with-lease ; sinon fallback --force
$leaseOk = $true
try { git fetch origin $Branch --quiet } catch { $leaseOk = $false }

if ($leaseOk) {
  Write-Host "PUSH en --force-with-lease vers $RepoUrl ($Branch)..." -ForegroundColor Yellow
  git push -u origin $Branch --force-with-lease
} else {
  Write-Host "Ref distante inconnue, fallback en --force (écrasement)..." -ForegroundColor Red
  git push -u origin $Branch --force
}

Write-Host "`n✅ Push terminé."
