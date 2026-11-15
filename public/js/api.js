/* Schmaler Wrapper um fetch: JSON rein, JSON raus, Fehler als Exception. */

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  const options = {
    method,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError('Der Server ist nicht erreichbar.', 0);
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      (payload && payload.error) || `Anfrage fehlgeschlagen (${response.status})`;
    const error = new ApiError(message, response.status, payload && payload.code);

    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      window.location.href = '/login';
    }
    if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
      window.dispatchEvent(new CustomEvent('hd:password-required'));
    }
    throw error;
  }

  return payload || {};
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),

  /* --------------------------- Benannte Aufrufe -------------------------- */

  me: () => request('GET', '/api/auth/me'),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  logoutAll: () => request('POST', '/api/auth/logout-all'),
  changePassword: (currentPassword, newPassword) =>
    request('POST', '/api/auth/password', { currentPassword, newPassword }),
  updateProfile: (displayName) => request('POST', '/api/auth/profile', { displayName }),

  listBookmarks: () => request('GET', '/api/bookmarks'),
  createBookmark: (data) => request('POST', '/api/bookmarks', data),
  updateBookmark: (id, data) => request('PUT', `/api/bookmarks/${id}`, data),
  deleteBookmark: (id) => request('DELETE', `/api/bookmarks/${id}`),
  setBookmarkPosition: (id, posX, posY) =>
    request('PUT', `/api/bookmarks/${id}/position`, { posX, posY }),
  setBookmarkEnabled: (id, enabled) =>
    request('PUT', `/api/bookmarks/${id}/enabled`, { enabled }),
  reorderBookmarks: (ids) => request('POST', '/api/bookmarks/reorder', { ids }),
  importBookmarks: (bookmarks) => request('POST', '/api/backup/import/bookmarks', { bookmarks }),

  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (settings) => request('PUT', '/api/settings', settings),
  resetSettings: () => request('POST', '/api/settings/reset'),

  listUsers: () => request('GET', '/api/users'),
  createUser: (data) => request('POST', '/api/users', data),
  updateUser: (id, data) => request('PUT', `/api/users/${id}`, data),
  deleteUser: (id) => request('DELETE', `/api/users/${id}`),

  fetchIcons: (url) => request('POST', '/api/icons/fetch', { url }),
  downloadIcon: (url) => request('POST', '/api/icons/download', { url }),

  importBackup: (payload) => request('POST', '/api/backup/import', payload),
};
