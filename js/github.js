// Minimal GitHub REST client used as the site's "backend".
// Every edit is a commit to the repo; GitHub Pages redeploys automatically.
const API = 'https://api.github.com';

export class GitHub {
  constructor(token, { owner, repo, branch = 'main' }) {
    Object.assign(this, { token, owner, repo, branch });
  }

  get base() { return `/repos/${this.owner}/${this.repo}`; }

  async req(path, { method = 'GET', body, accept } = {}) {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch {}
      const err = new Error(`GitHub ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return accept && accept.includes('raw') ? res.text() : res.json();
  }

  repoInfo() { return this.req(this.base); }
  user() { return this.req('/user'); }

  contentsPath(path) {
    return `${this.base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Returns { sha, text } for a text file (handles >1MB via blob API). */
  async readText(path) {
    const meta = await this.req(`${this.contentsPath(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (meta.content) return { sha: meta.sha, text: b64ToText(meta.content) };
    const blob = await this.req(`${this.base}/git/blobs/${meta.sha}`);
    return { sha: meta.sha, text: b64ToText(blob.content) };
  }

  putFile(path, contentB64, message, sha) {
    return this.req(this.contentsPath(path), {
      method: 'PUT',
      body: { message, content: contentB64, branch: this.branch, ...(sha ? { sha } : {}) },
    });
  }
}

export function bytesToB64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
export const textToB64 = (t) => bytesToB64(new TextEncoder().encode(t));
export const b64ToText = (b) =>
  new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
export const fileToB64 = async (file) => bytesToB64(new Uint8Array(await file.arrayBuffer()));
