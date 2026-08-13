# No-Node Fallback Mode

Use this only when Node.js cannot be used.

## Start Locally

Double-click:

```bat
start-python-view-only.bat
```

Then open:

```text
http://127.0.0.1:4175/
```

## Start On Office Network

Double-click:

```bat
start-python-network-view-only.bat
```

Other staff can try:

```text
http://SERVER-IP:4175/
```

## What Works

- Front page viewing
- Layout/design review
- Static screens
- Planning and presentation

## What Does Not Work Without Node

- Real contract upload processing
- OCR jobs
- SQLite database saving
- Review queue persistence
- Invoice matching
- Backups and restore
- Login/users/roles
- Admin readiness checks from the backend

## Real App Mode Later

When Node.js is allowed again, use:

```bat
start-windows-server.bat
```

That starts the real internal office app with database, OCR, uploads, reports, backups, and readiness checks.
