// CLI helper to list and approve organizations without opening the admin page.
//
//   npm run approve                       -> list all organizations
//   npm run approve -- <email>            -> approve the org with that email
//   npm run approve -- <email> off        -> revoke approval
//
import db from '../server/db.js';

const [, , email, flag] = process.argv;

function list() {
  const rows = db
    .prepare(
      `SELECT id, name, city, email, approved FROM organizations
       ORDER BY approved ASC, id ASC`
    )
    .all();
  if (rows.length === 0) {
    console.log('No organizations yet.');
    return;
  }
  console.log('\n   id  status     org (city) <email>');
  console.log('  ---------------------------------------------------------------');
  for (const o of rows) {
    const status = o.approved ? 'APPROVED' : 'pending ';
    console.log(`  ${String(o.id).padStart(3)}  ${status}  ${o.name} (${o.city}) <${o.email}>`);
  }
  console.log('\nApprove with:  npm run approve -- <email>\n');
}

if (!email) {
  list();
  process.exit(0);
}

const approved = flag === 'off' || flag === 'false' ? 0 : 1;
const org = db.prepare('SELECT * FROM organizations WHERE lower(email) = ?').get(email.toLowerCase());
if (!org) {
  console.error(`No organization found with email: ${email}`);
  process.exit(1);
}
db.prepare('UPDATE organizations SET approved = ? WHERE id = ?').run(approved, org.id);
console.log(`${approved ? 'Approved' : 'Unapproved'}: ${org.name} <${org.email}>`);
