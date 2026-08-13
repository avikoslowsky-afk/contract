# Windows Server Runbook

Use this when the app should run for the work team from one Windows computer or internal Windows server.

## Goal

One computer hosts the app. Everyone else opens it in a browser.

```text
Team browsers -> Windows server/work computer -> OCR + database + uploads + reports + AI
```

## Server Computer Requirements

- Windows 10/11 Pro or Windows Server
- Node.js LTS or newer
- Python 3
- Tesseract OCR
- Optional: Ollama for free local AI
- Enough disk space for uploads and backups
- A stable local network IP address

## Start The Server

For testing, sign-in is off by default. Later, when you want sign-in back on, create a `.env` file from `.env.example` and change:

```text
REQUIRE_LOGIN=true
ADMIN_USER=your.admin@company.com
ADMIN_PASSWORD=use-a-long-private-password
```

Double-click:

```text
start-windows-server.bat
```

This runs the app on:

```text
http://0.0.0.0:4182/
```

People on the work network should open:

```text
http://SERVER-IP:4182/
```

Replace `SERVER-IP` with the Windows computer's local IP.

## Open Firewall

If other computers cannot connect, right-click and run as Administrator:

```text
open-windows-firewall.bat
```

This opens TCP port `4182`.

## Start Automatically After Restart

Right-click and run as Administrator:

```text
install-windows-startup-task.bat
```

This creates a Windows startup task so the app starts after the server restarts.

## Backups

Use Admin -> Create Backup before bulk uploads, OCR testing, and production changes.

Backups are stored in:

```text
data\backups
```

Do not put backup files on public GitHub.

## Production Notes

Before real production use:

- Use a private work network/VPN.
- Add real Microsoft login/SSO.
- Use HTTPS/reverse proxy if accessed beyond the local network.
- Test restore from backup.
- Keep GitHub private.
- Never upload real contracts or `.env` secrets to GitHub.
