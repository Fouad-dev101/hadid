# Prepares the two GitHub secrets that let GitHub sign your APK. Run after make-keystore.bat.
#   powershell -File tools\keystore-to-secrets.ps1
$ks    = Join-Path $PSScriptRoot '..\android\hadid-release.jks'
$props = Join-Path $PSScriptRoot '..\android\keystore.properties'
if (-not (Test-Path $ks) -or -not (Test-Path $props)) { Write-Host 'Run make-keystore.bat first.'; exit 1 }
$pw  = ((Get-Content $props | Where-Object { $_ -like 'storePassword=*' }) -replace '^storePassword=', '').Trim()
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ks))
Set-Clipboard -Value $b64
Write-Host ''
Write-Host 'On GitHub: your repo > Settings > Secrets and variables > Actions > New repository secret'
Write-Host ''
Write-Host '1) Name:   ANDROID_KEYSTORE_BASE64'
Write-Host '   Value:  already in your clipboard, just paste (Ctrl+V)'
Write-Host ''
Write-Host '2) Name:   ANDROID_KEYSTORE_PASSWORD'
Write-Host "   Value:  $pw"
Write-Host ''
Write-Host 'Never commit hadid-release.jks or keystore.properties (the .gitignore already blocks them).'
