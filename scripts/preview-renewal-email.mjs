import {writeFile} from 'node:fs/promises';
import {reminderItems, reminderHtml} from '../renewal-email.mjs';
const settings = {renewalAppUrl:'http://127.0.0.1:4182/'};
const items = reminderItems([
  {contractId:'example-staffing',contractName:'Example Staffing Agreement',vendor:'Example Staffing',facility:'Bronx Center',days:24,targetDate:'2026-10-02',renewalEndDate:'2026-11-01',alertBasis:'Cancellation notice deadline',requiredAction:'Review renewal and cancellation options.'},
  {contractId:'example-landscaping',contractName:'Example Landscaping Agreement',vendor:'Example Landscaping',facility:'Brooklyn Center',days:55,targetDate:'2026-11-02',renewalEndDate:'2026-11-02',alertBasis:'Contract expiration',requiredAction:'Decide whether to renew.'},
  {contractId:'example-equipment',contractName:'Example Equipment Agreement',vendor:'Example Equipment',facility:'Bronx Center',days:82,targetDate:'2026-11-29',renewalEndDate:'2026-11-29',alertBasis:'Contract expiration',requiredAction:'Review the upcoming expiration.'}
],settings);
await writeFile(new URL('../renewal-email-example.html',import.meta.url),reminderHtml(items).replace('CONTRACT OPERATIONS','CONTRACT OPERATIONS &middot; SAMPLE ONLY').replaceAll('href="http://127.0.0.1:4182/', 'href="#sample-'));
console.log('Created renewal-email-example.html with fictional records.');
