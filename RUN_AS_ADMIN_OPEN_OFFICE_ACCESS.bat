@echo off
echo Opening office access for Contract Operations...
echo.
netsh advfirewall firewall add rule name="Contract Operations 4182" dir=in action=allow protocol=TCP localport=4182 profile=domain,private
echo.
echo If you see "Ok.", staff on the office network can use:
echo http://192.168.251.19:4182
echo.
pause
