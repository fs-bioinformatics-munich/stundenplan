import { CONTACT } from '../config';

export function Footer() {
  const { heading, name, email, note } = CONTACT;
  return (
    <footer class="site-footer">
      <div class="contact-box">
        <h3>{heading}</h3>
        {name && <p>{name}</p>}
        {email && <p><a href={`mailto:${email}`}>{email}</a></p>}
        {note && <p class="muted">{note}</p>}
        {!name && !email && !note && <p class="muted">Contact details not filled in yet (src/config.ts).</p>}
      </div>
    </footer>
  );
}
