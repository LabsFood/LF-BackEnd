/**
 * Loads the Brevo transactional templates: `layout.html` wrapped around each
 * `templates/<BREVO_TPL_NAME>.html`. The file name is the env var that holds the
 * template's Brevo id.
 *
 * Each template file starts with `<!-- subject: … -->` (removed here) and a
 * `{% comment %}params: …{% endcomment %}` block, kept so it shows in Brevo's editor;
 * Brevo strips it when rendering. The rest is Brevo template language (Pongo2):
 * `{{ params.x }}` is HTML-escaped by Brevo at send time.
 *
 * Only static files go through here; no runtime data is ever interpolated in Node.
 */
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('./templates/', import.meta.url);
const layout = readFileSync(new URL('./layout.html', import.meta.url), 'utf8');

export const templates = readdirSync(dir)
  .filter((file) => file.endsWith('.html'))
  .sort()
  .map((file) => {
    const source = readFileSync(new URL(file, dir), 'utf8');
    const [header, subject] = source.match(/^<!-- subject: (.+) -->\n/) ?? [];
    if (!subject) throw new Error(`brevo/templates/${file}: first line must be <!-- subject: … -->`);
    const body = source.slice(header.length).replace(/\n$/, '');
    return {
      name: file.slice(0, -'.html'.length),
      subject,
      // Functions, not strings: a `$&` or `$'` in the copy must stay literal.
      html: layout.replace('<!-- title -->', () => subject).replace('<!-- content -->', () => body),
    };
  });
