<#
    Pubblica il progetto: rigenera il modello se serve, salva su GitHub, ridispiega
    su Cloudflare.

    USO

      .\deploy.ps1 "ho sistemato i colori"
          commit + push + deploy. Il caso normale.

      .\deploy.ps1 "nuove domande" -Modello
          rigenera prima PCA e UMAP da tools/build_model.py.
          Se la mappa cambia ti chiede se svuotare il database, perche' i punti
          vecchi si riferiscono a coordinate che non esistono piu'.

      .\deploy.ps1 -SoloDeploy
          ridispiega quello che c'e' senza toccare git.

      .\deploy.ps1 -Svuota
          cancella i partecipanti e basta. Da usare a fine serata.
#>

param(
    [Parameter(Position = 0)]
    [string]$Messaggio = "",

    [switch]$Modello,
    [switch]$SoloDeploy,
    [switch]$Svuota
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Titolo($testo) { Write-Host "`n=== $testo" -ForegroundColor Cyan }
function Ok($testo)     { Write-Host "    $testo" -ForegroundColor Green }
function Nota($testo)   { Write-Host "    $testo" -ForegroundColor DarkGray }
function Stop($testo)   { Write-Host "`n$testo`n" -ForegroundColor Red; exit 1 }

if (-not (Test-Path "wrangler.toml")) {
    Stop "Non sei nella cartella del progetto: qui non c'e' wrangler.toml."
}

$progetto = (Select-String -Path "wrangler.toml" -Pattern '^name\s*=\s*"(.+)"').Matches[0].Groups[1].Value
$database = (Select-String -Path "wrangler.toml" -Pattern '^database_name\s*=\s*"(.+)"').Matches[0].Groups[1].Value

# ---------------------------------------------------------------- solo svuota

if ($Svuota) {
    Titolo "Svuoto il database $database"
    $conferma = Read-Host "    Cancello TUTTI i partecipanti. Scrivi si per confermare"
    if ($conferma -ne "si") { Nota "Annullato."; exit 0 }
    npx.cmd wrangler d1 execute $database --remote --command "DELETE FROM participants; DELETE FROM sqlite_sequence WHERE name='participants';"
    if ($LASTEXITCODE -ne 0) { Stop "Non sono riuscito a svuotare il database." }
    Ok "Mappa vuota."
    exit 0
}

# ------------------------------------------------------------------- modello

$mappaCambiata = $false

if ($Modello) {
    Titolo "Rigenero PCA e UMAP"

    $python = $null
    foreach ($cmd in @("python", "py", "python3")) {
        if (Get-Command $cmd -ErrorAction SilentlyContinue) { $python = $cmd; break }
    }
    if (-not $python) {
        Stop "Python non trovato. Installalo da python.org, poi: pip install -r tools/requirements.txt"
    }

    $primaModel = if (Test-Path "shared/model.js") { (Get-FileHash "shared/model.js").Hash } else { "" }

    & $python tools/build_model.py
    if ($LASTEXITCODE -ne 0) {
        Stop "build_model.py e' andato in errore. Se mancano le librerie: pip install -r tools/requirements.txt"
    }

    $dopoModel = (Get-FileHash "shared/model.js").Hash
    $mappaCambiata = ($primaModel -ne $dopoModel)

    if ($mappaCambiata) {
        Ok "Mappa nuova. I punti gia' salvati non sono piu' validi."
    } else {
        Nota "Il modello e' identico a prima, la mappa non si muove."
    }
}

# ----------------------------------------------------------------------- git

if (-not $SoloDeploy) {
    Titolo "Salvo su GitHub"

    $modificati = git status --porcelain
    if ([string]::IsNullOrWhiteSpace($modificati)) {
        Nota "Niente da salvare, vado dritto al deploy."
    } else {
        if ([string]::IsNullOrWhiteSpace($Messaggio)) {
            $Messaggio = Read-Host "    Messaggio del commit"
            if ([string]::IsNullOrWhiteSpace($Messaggio)) { Stop "Serve un messaggio." }
        }
        git add -A
        git commit -m $Messaggio
        if ($LASTEXITCODE -ne 0) { Stop "git commit fallito." }
        git push
        if ($LASTEXITCODE -ne 0) { Stop "git push fallito. Controlla la connessione o le credenziali GitHub." }
        Ok "Pushato."
    }
}

# ------------------------------------------------------------------ deploy

Titolo "Pubblico su Cloudflare"
npx.cmd wrangler pages deploy --project-name $progetto --commit-dirty=true
if ($LASTEXITCODE -ne 0) { Stop "Il deploy e' fallito. Guarda l'errore qui sopra." }

# -------------------------------------------------------- pulizia dopo modello

if ($mappaCambiata) {
    Titolo "Il database va svuotato"
    Write-Host "    Le persone salvate prima hanno coordinate della mappa vecchia:" -ForegroundColor Yellow
    Write-Host "    se le lasci, compaiono nel posto sbagliato." -ForegroundColor Yellow
    $conferma = Read-Host "    Le cancello adesso? (si/no)"
    if ($conferma -eq "si") {
        npx.cmd wrangler d1 execute $database --remote --command "DELETE FROM participants; DELETE FROM sqlite_sequence WHERE name='participants';"
        if ($LASTEXITCODE -eq 0) { Ok "Mappa vuota." } else { Nota "Non ci sono riuscito, fallo a mano con .\deploy.ps1 -Svuota" }
    } else {
        Nota "Ricordati di farlo prima dell'evento: .\deploy.ps1 -Svuota"
    }
}

Write-Host ""
Ok "Online: https://$progetto.pages.dev"
Write-Host ""