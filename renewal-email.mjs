export function reminderSettings(settings) {
  const assignments = (settings.renewalAssignments || []).map(row => ({email:String(row.email || '').trim().toLowerCase(), facilities:[...new Set((row.facilities || []).map(String).filter(Boolean))]}));
  const recipients = [...new Set(assignments.map(row => row.email))];
  if (assignments.some(row => !row.email || !row.facilities.length)) throw new Error('Each recipient needs an email and at least one facility.');
  if (recipients.some(x => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x))) throw new Error('Enter valid recipient email addresses.');
  const days = [...new Set(String(settings.alertSchedule || '90,60,30').match(/\d+/g)?.map(Number) || [])].sort((a,b) => a-b);
  if (!days.length || days.some(x => x < 1 || x > 365)) throw new Error('Reminder days must be between 1 and 365.');
  let base = String(settings.renewalAppUrl || '').trim();
  if (base) {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or HTTPS app address.');
    base = url.origin + url.pathname;
  }
  const enabled = settings.renewalEmailEnabled === true;
  if (enabled && (!recipients.length || !base)) throw new Error('Add recipients and an app address before enabling reminders.');
  return {recipients, assignments, days, base, enabled};
}

export function reminderItems(alerts, settings) {
  const config = reminderSettings(settings);
  return alerts.filter(a => a.days >= 0 && a.days <= Math.max(...config.days)).map(a => {
    const window = config.days.find(d => a.days <= d);
    const link = config.base ? `${config.base}?contract=${encodeURIComponent(a.contractId)}#contracts` : '';
    const vendorLink = link ? link.replace('#contracts', '&view=vendor#contracts') : '';
    return {...a, window, link, vendorLink, key: JSON.stringify([a.contractId, a.targetDate, a.alertBasis, window])};
  });
}

export function recipientItems(items, settings, email) {
  const assigned = new Set(reminderSettings(settings).assignments.filter(row => row.email === email).flatMap(row => row.facilities));
  return items.filter(item => assigned.has(item.facility));
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reminderHtml(items) {
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}) : value || 'Not recorded';
  const counts = [items.filter(a=>a.days<=30).length, items.filter(a=>a.days>30 && a.days<=60).length, items.filter(a=>a.days>60).length];
  const rows = [...items].sort((a,b) => a.days-b.days).map(a => {
    const urgent = a.days <= 30;
    return `<tr><td class="content" style="padding:26px 32px;border-bottom:1px solid #e3e7f0;overflow-wrap:anywhere">
      <span style="display:inline-block;padding:4px 9px;border-radius:4px;font-size:12px;font-weight:bold;background:${urgent?'#fff0ed':'#f0eefb'};color:${urgent?'#b42318':'#2f267f'}">${escape(a.days)} days remaining</span>
      <h2 style="font-size:18px;line-height:1.4;margin:12px 0 6px;color:#101828">${escape(a.contractName)}</h2>
      <p style="margin:0 0 16px;color:#667085">${escape(a.facility)} &middot; ${escape(a.vendor)}</p>
      <table role="presentation" style="width:100%;font-size:13px;border-collapse:collapse"><tr><td style="padding:0 8px 4px 0;color:#667085;width:45%">Action deadline</td><td style="padding:0 0 4px;color:#667085">Renewal / end date</td></tr><tr><td style="padding:0 8px 0 0;font-weight:bold;color:#101828">${escape(date(a.targetDate))}</td><td style="font-weight:bold;color:#101828">${escape(date(a.renewalEndDate))}</td></tr></table>
      <p style="margin:6px 0 16px;font-size:12px;color:#667085">${escape(a.alertBasis)}</p>
      <p style="margin:0 0 18px;color:#344054"><strong>Next step:</strong> ${escape(a.requiredAction)}</p>
      <a style="display:inline-block;background:#f0eefb;border:1px solid #827ab6;color:#241d60;padding:12px 18px;margin:0 0 8px;font-size:16px;line-height:24px;font-weight:bold;text-decoration:underline;border-radius:6px" href="${escape(a.link)}">Open Contract</a>
    </td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contract Operations | Renewal Summary</title><style>@media(max-width:480px){.content{padding:22px 18px!important}.email-shell{margin:0 auto!important}}</style></head><body style="margin:0;background:#f5f7fb;font:14px/1.5 Arial,sans-serif;letter-spacing:0;color:#101828"><table role="presentation" class="email-shell" style="width:100%;max-width:680px;margin:24px auto;background:#fff;border:1px solid #e3e7f0;border-collapse:collapse;table-layout:fixed">
    <tr><td style="height:5px;background:#2f267f;padding:0"></td></tr>
    <tr><td class="content" style="padding:26px 32px 24px"><div style="font-size:12px;font-weight:bold;color:#2f267f">CONTRACT OPERATIONS</div><h1 style="font-size:26px;line-height:1.25;margin:12px 0 8px;color:#101828">Your renewal summary</h1><p style="margin:0;color:#667085">${items.length} contract${items.length===1?'':'s'} for your assigned facilities</p></td></tr>
    <tr><td class="content" style="padding:0 32px 24px;border-bottom:1px solid #e3e7f0"><table role="presentation" style="width:100%;border-collapse:collapse;background:#f7f8fc"><tr>${['0-30 days','31-60 days','61+ days'].map((label,i)=>`<td style="width:33%;padding:14px 8px;text-align:center;border-top:3px solid ${['#ef3d1f','#f6b200','#2f267f'][i]}"><strong style="display:block;font-size:22px;color:#101828">${counts[i]}</strong><span style="font-size:12px;color:#667085">${label}</span></td>`).join('')}</tr></table></td></tr>
    ${rows || '<tr><td class="content" style="padding:24px 32px">No reminders are due for your facilities.</td></tr>'}
    <tr><td class="content" style="padding:22px 32px;background:#f7f8fc;font-size:12px;color:#667085"><strong style="color:#344054">Contract Operations &middot; Renewal reminders</strong><p style="margin:8px 0 0">Dates reflect saved contract information. Notice deadlines may precede renewal. Sign in to review the original agreement.</p></td></tr></table></body></html>`;
}

export function reminderText(items) {
  return items.map(a => `${a.contractName}\nVendor: ${a.vendor}\nFacility: ${a.facility}\nService: ${a.category}\nAction date: ${a.targetDate} (${a.days} days remaining)\nDate basis: ${a.alertBasis}\nReminder window: ${a.window} days\nRenewal/end date: ${a.renewalEndDate || 'Not recorded'}\nAction: ${a.requiredAction}\nOpen contract: ${a.link || 'Set the app address in Admin'}`).join('\n\n--------------------\n\n') || 'No renewal reminders are due.';
}
