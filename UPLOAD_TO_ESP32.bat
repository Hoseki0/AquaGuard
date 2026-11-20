@echo off
color 0A
echo.
echo  =============================================
echo   ESP32 UPLOAD - MANUAL BOOTLOADER METHOD
echo  =============================================
echo.
echo  STEP 1: Do this NOW on your ESP32 board:
echo    a) Hold the BOOT button
echo    b) Tap EN once  (keep holding BOOT)
echo    c) Release BOOT button
echo.
echo  STEP 2: Immediately press any key here.
echo.
echo  =============================================
pause

set ESPTOOL=C:\Users\Jem\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\4.5.1\esptool.exe
set SKETCH=C:\Users\Jem\AppData\Local\arduino\sketches\73DFF1F2D48CA0EA786F9E1DF3CD29FD

set BINFILE=%SKETCH%\water_level_monitor.ino.bin
set BOOTLOADER=%SKETCH%\water_level_monitor.ino.bootloader.bin
set PARTITIONS=%SKETCH%\water_level_monitor.ino.partitions.bin

echo.
echo Uploading firmware to ESP32 on COM3...
echo.

"%ESPTOOL%" --chip esp32 --port COM3 --baud 115200 --before no_reset --after hard_reset write_flash -z --flash_mode dio --flash_freq 80m --flash_size detect 0x1000 "%BOOTLOADER%" 0x8000 "%PARTITIONS%" 0x10000 "%BINFILE%"

echo.
if %ERRORLEVEL% == 0 (
    color 0A
    echo  =============================================
    echo   SUCCESS! Firmware uploaded to ESP32!
    echo   You can now release the BOOT button.
    echo  =============================================
) else (
    color 0C
    echo  =============================================
    echo   FAILED. Repeat BOOT+EN steps and try again
    echo  =============================================
)
echo.
pause
