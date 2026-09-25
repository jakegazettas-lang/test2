// Shared sign-in helper for every page.
// window.currentUser resolves to { name, firstName, lastName, email, initials, roles } or null.
(function () {
  const claimValue = (claims, ...types) => {
    for (const t of types) {
      const c = (claims || []).find(x => x.typ === t);
      if (c && c.val) return c.val;
    }
    return '';
  };
  const titleCase = s => s.replace(/\b\w/g, ch => ch.toUpperCase());

  window.currentUser = fetch('/.auth/me', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      const p = data && data.clientPrincipal;
      if (!p) return null;
      const email = p.userDetails || '';
      let name = claimValue(p.claims, 'name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name');
      if (!name || name.includes('@')) {
        name = titleCase((email.split('@')[0] || 'User').replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim() || 'User');
      }
      let first = claimValue(p.claims, 'given_name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname');
      let last = claimValue(p.claims, 'family_name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname');
      if (!first) {
        const parts = name.trim().split(/\s+/);
        first = parts.shift() || '';
        last = last || parts.join(' ');
      }
      const initials = ((first[0] || '') + (last[0] || '')).toUpperCase() || name.slice(0, 2).toUpperCase();
      const roles = (p.userRoles || []).map(r => String(r).toLowerCase());
      const isAdmin = roles.includes('administrator') || roles.includes('admin');
      return { name, firstName: first, lastName: last, email, initials, roles, isAdmin, roleLabel: isAdmin ? 'Administrator' : 'Staff' };
    })
    .catch(() => null);

  // "Signed in as" badge in the page header
  window.currentUser.then(user => {
    if (!user) return;
    const header = document.querySelector('header.page');
    if (!header) return;
    let controls = header.querySelector('.controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'controls';
      header.appendChild(controls);
    }
    const chip = document.createElement('div');
    chip.className = 'user-chip';
    chip.innerHTML = '<span class="avatar" aria-hidden="true"></span><span class="who"><b></b><small></small></span>' +
      '<a class="signout" href="/.auth/logout?post_logout_redirect_uri=/login.html">Sign out</a>';
    chip.querySelector('.avatar').textContent = user.initials;
    chip.querySelector('b').textContent = user.name;
    chip.querySelector('small').textContent = `${user.roleLabel} · ${user.email}`;
    chip.title = `Signed in as ${user.name} (${user.email}), ${user.roleLabel.toLowerCase()}`;
    controls.appendChild(chip);
    document.querySelectorAll('.rail a[href^="/.auth/logout"]').forEach(a => {
      a.title = `Sign out ${user.name}`;
      a.setAttribute('aria-label', `Sign out ${user.name}`);
    });
  });
})();
