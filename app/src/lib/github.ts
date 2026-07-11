// Thin GitHub client for in-app ingest: reads the live doors.json and writes
// one commit (photos + data) to main via the Git Data API. Auth is a
// fine-grained PAT (Contents: read/write on this repo only) kept in
// localStorage — acceptable because this is a single-user personal app.

import type { Door } from './types';

export const REPO_OWNER = 'joaopdecarvalho';
export const REPO_NAME = 'DoorsWorld';
export const REPO_BRANCH = 'main';
export const DOORS_JSON_PATH = 'app/src/data/doors.json';
export const PHOTOS_DIR = 'app/public/photos';

const TOKEN_KEY = 'doorsworld-gh-token';
const API = 'https://api.github.com';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t.trim());
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg = `GitHub API ${res.status}`;
    try {
      msg += `: ${JSON.parse(body).message}`;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) msg += ' — token invalid or expired.';
    if (res.status === 403 || res.status === 404)
      msg += ' — check the token has Contents read/write on this repo.';
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** True when the token can push to the repo. */
export async function verifyToken(token: string): Promise<boolean> {
  try {
    const repo = await api<{ permissions?: { push?: boolean } }>(
      token,
      `/repos/${REPO_OWNER}/${REPO_NAME}`,
    );
    return repo.permissions?.push === true;
  } catch {
    return false;
  }
}

/** The doors.json currently on main — the source of truth for ids/merging
 *  (the bundled copy in this build may be behind the repo). */
export async function fetchLiveDoors(token: string): Promise<Door[]> {
  const res = await fetch(
    `${API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DOORS_JSON_PATH}?ref=${REPO_BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) throw new Error(`Couldn't read doors.json from GitHub (HTTP ${res.status})`);
  return res.json();
}

export interface CommitFile {
  path: string;
  /** Exactly one of the two. */
  base64?: string;
  text?: string;
}

/** One commit on main containing all given files. Returns the commit sha. */
export async function commitFiles(
  token: string,
  files: CommitFile[],
  message: string,
): Promise<string> {
  const repo = `/repos/${REPO_OWNER}/${REPO_NAME}`;

  const ref = await api<{ object: { sha: string } }>(
    token,
    `${repo}/git/ref/heads/${REPO_BRANCH}`,
  );
  const headSha = ref.object.sha;
  const head = await api<{ tree: { sha: string } }>(token, `${repo}/git/commits/${headSha}`);

  const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha?: string; content?: string }> =
    [];
  for (const f of files) {
    if (f.base64 != null) {
      const blob = await api<{ sha: string }>(token, `${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: f.base64, encoding: 'base64' }),
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    } else {
      tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.text ?? '' });
    }
  }

  const newTree = await api<{ sha: string }>(token, `${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: head.tree.sha, tree }),
  });
  const commit = await api<{ sha: string }>(token, `${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
  });
  await api(token, `${repo}/git/refs/heads/${REPO_BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });
  return commit.sha;
}

/** Blob → base64 without blowing the call stack on large photos. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
