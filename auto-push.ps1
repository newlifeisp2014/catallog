
# ==========================================
#   NewLife - Auto Git Push Watcher
#   يراقب الملفات ويرفع تلقائياً على GitHub
# ==========================================

$ProjectPath = "C:\Users\Newlife\Desktop\catallog-main"
$CheckInterval = 30  # ثواني بين كل فحص

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   NewLife Auto-Push - مراقب الرفع التلقائي  " -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "المشروع : $ProjectPath" -ForegroundColor White
Write-Host "الفحص كل: $CheckInterval ثانية" -ForegroundColor White
Write-Host "GitHub  : https://github.com/newlifeisp2014/catallog" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "السكريبت يعمل... اضغط Ctrl+C للإيقاف" -ForegroundColor Green
Write-Host ""

Set-Location $ProjectPath

while ($true) {
    $status = git status --porcelain 2>&1

    if ($status) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Write-Host "[$timestamp] تم اكتشاف تغييرات... جاري الرفع" -ForegroundColor Yellow

        git add . 2>&1 | Out-Null

        $commitMsg = "auto: تحديث تلقائي - $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
        git commit -m $commitMsg 2>&1 | Out-Null

        $pushResult = git push origin main 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[$timestamp] تم الرفع بنجاح على GitHub!" -ForegroundColor Green
        } else {
            Write-Host "[$timestamp] خطأ في الرفع: $pushResult" -ForegroundColor Red
        }
        Write-Host ""
    }

    Start-Sleep -Seconds $CheckInterval
}
