# Contract Operations Email Setup

Contract Operations can send user invitations, password resets, and contract lifecycle alerts through the company SMTP service.

## Information Needed From IT

- SMTP host
- SMTP port (`587` with STARTTLS is recommended; `465` is also supported)
- Dedicated sending mailbox username
- Mailbox password or application password
- Approved From address
- Alert recipient mailbox or distribution list
- Permanent internal application URL

## Backend Configuration

Open `.env` in the application folder and complete these values:

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=contracts@company.com
SMTP_PASS=IT_PROVIDED_SECRET
SMTP_FROM=Contract Operations <contracts@company.com>
ALERT_EMAIL_TO=contractteam@company.com
APP_BASE_URL=http://192.168.251.19:4182
```

Do not email or commit the completed `.env` file. It contains a password.

For Microsoft 365, IT may need to enable Authenticated SMTP for the dedicated mailbox. If the organization blocks basic SMTP authentication, IT should provide an approved SMTP relay instead.

## Activate And Test

1. Restart `start-windows-server.bat` after updating `.env`.
2. Sign in as an Admin.
3. Open **Admin > Settings**.
4. Confirm **Email connection** says Connected.
5. Enter an internal address under **Test recipient**.
6. Click **Send Test Email**.
7. Confirm the message arrives.

Once the test succeeds, **Send Invite**, **Forgot Password**, and lifecycle-alert sending use the same connection.
