// ══════════════════════════════════════════════════════════
//  MyTodo — app.js
//  Firebase imports (ES module, loaded via type="module")
// ══════════════════════════════════════════════════════════

import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut as fbSignOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, set, get, onValue, off }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ══════════════════════════════════════════════════════════
//  FIREBASE CONFIG
//  ► Paste YOUR Firebase project config here (one time).
//  ► Users never see this — they just click "Sign in with Google".
//
//  How to get it (2 min):
//  1. console.firebase.google.com → New project
//  2. Add Web app (</>) → copy firebaseConfig object
//  3. Authentication → Sign-in method → Enable Google
//  4. Add your GitHub Pages URL to Authorized Domains
//  5. Realtime Database → Create database → Start in test mode
//  6. Paste the values below and deploy!
// ══════════════════════════════════════════════════════════

const FIREBASE_CONFIG =
{
  apiKey: "AIzaSyCdxxgCseDsDN7J15_zDLdfsIPTGg58K9c",
  authDomain: "mytodo-4384b.firebaseapp.com",
  projectId: "mytodo-4384b",
  storageBucket: "mytodo-4384b.firebasestorage.app",
  messagingSenderId: "844511072251",
  appId: "1:844511072251:web:51c5edc458dbffe5a4855e",
  measurementId: "G-NWNWG2YW25"
};

const IS_CONFIGURED = !FIREBASE_CONFIG.apiKey.includes("PASTE");

// ══════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════
let tasks   = [];
let filter  = "all";
let cat     = "";
let fbApp, fbAuth, fbDb;
let user    = null;
let liveRef = null;

const LS_TASKS  = "tf_tasks_v3";
const LS_BACKUP = "tf_backup_ts";
const LS_USER   = "tf_user_cache";  // cached user info for offline sessions

// ══════════════════════════════════════════════════════════
//  BOOT — app is ALWAYS usable, even without network
// ══════════════════════════════════════════════════════════
(function boot() {
  // Load tasks from localStorage immediately (works offline)
  try { tasks = JSON.parse(localStorage.getItem(LS_TASKS) || "[]"); } catch { /**/ }
  render();
  updateStats();

  if (!IS_CONFIGURED) {
    hideLoader();
    onSignedOut();
    toast("⚠️ Paste your Firebase config in app.js to enable sync.", "in");
    return;
  }

  fbApp  = initializeApp(FIREBASE_CONFIG);
  fbAuth = getAuth(fbApp);
  fbDb   = getDatabase(fbApp);

  // If offline/slow network: unblock the UI after 3 s using cached session
  const offlineTimer = setTimeout(() => {
    const cached = getCachedUser();
    hideLoader();
    if (cached) {
      onSignedIn(cached, true);   // offline mode — show local data
      toast("You're offline — showing saved tasks", "in");
    } else {
      onSignedOut();
    }
  }, 3000);

  // When Firebase auth resolves, cancel the offline timer
  onAuthStateChanged(fbAuth, (u) => {
    clearTimeout(offlineTimer);
    hideLoader();
    if (u) {
      cacheUser(u);
      user = u;
      onSignedIn(u, false);       // full online mode
    } else {
      clearCachedUser();
      user = null;
      onSignedOut();
    }
  });
})();

// ══════════════════════════════════════════════════════════
//  USER CACHE (keeps UI working when offline on reload)
// ══════════════════════════════════════════════════════════
function cacheUser(u) {
  localStorage.setItem(LS_USER, JSON.stringify({
    uid: u.uid, displayName: u.displayName,
    email: u.email, photoURL: u.photoURL
  }));
}
function getCachedUser() {
  try { return JSON.parse(localStorage.getItem(LS_USER)); } catch { return null; }
}
function clearCachedUser() { localStorage.removeItem(LS_USER); }

// ══════════════════════════════════════════════════════════
//  SIGNED IN
// ══════════════════════════════════════════════════════════
function onSignedIn(u, offlineMode = false) {
  // Header: show user chip, hide sign-in button
  g("userChip").style.display        = "";
  g("btnHeaderSignIn").style.display = "none";
  g("uName").textContent             = u.displayName || "User";
  g("uEmail").textContent            = u.email || "";

  // Avatar: photo or initials
  const av = g("uAvatar");
  if (u.photoURL && av && av.tagName !== "IMG") {
    const img = document.createElement("img");
    img.className = "u-photo";
    img.src = u.photoURL;
    img.referrerPolicy = "no-referrer";
    av.replaceWith(img);
  } else if (av && av.tagName !== "IMG") {
    av.textContent = (u.displayName || u.email || "U")[0].toUpperCase();
  }

  // Show sync banner, hide promo banner
  g("syncBanner").style.display  = "";
  g("promoBanner").style.display = "none";
  updateSubText();

  if (offlineMode) {
    // Don't attempt Firebase — show cached local data
    setSyncStatus("local", "Offline");
    render(); updateStats();
    // Auto-reconnect when network returns
    window.addEventListener("online", () => {
      if (user) { setSyncStatus("saving", "Reconnecting…"); startSync(user.uid); }
    }, { once: true });
  } else {
    setSyncStatus("saving", "Connecting…");
    startSync(u.uid);
  }
}

// ══════════════════════════════════════════════════════════
//  SIGNED OUT
// ══════════════════════════════════════════════════════════
function onSignedOut() {
  g("userChip").style.display        = "none";
  g("btnHeaderSignIn").style.display = "";
  g("syncBanner").style.display      = "none";
  g("promoBanner").style.display     = "";
  setSyncStatus("local", "Local only");
  if (liveRef) { off(liveRef); liveRef = null; }
}

// ══════════════════════════════════════════════════════════
//  GOOGLE SIGN-IN
// ══════════════════════════════════════════════════════════
async function doSignIn() {
  if (!IS_CONFIGURED) {
    toast("Firebase not configured yet. See app.js comments.", "er");
    return;
  }
  closeModal();
  setSyncStatus("saving", "Signing in…");
  try {
    await signInWithPopup(fbAuth, new GoogleAuthProvider());
    // onAuthStateChanged fires → onSignedIn()
  } catch (e) {
    setSyncStatus("local", "Local only");
    if (e.code !== "auth/popup-closed-by-user") {
      toast("Sign-in failed: " + e.message, "er");
    }
  }
}

// ══════════════════════════════════════════════════════════
//  SIGN OUT
// ══════════════════════════════════════════════════════════
g("btnSignOut").onclick = async () => {
  if (!fbAuth) return;
  await fbSignOut(fbAuth);
  clearCachedUser();
  user = null;
  onSignedOut();
  toast("Signed out. Your local tasks are still here.", "in");
};

// ══════════════════════════════════════════════════════════
//  REALTIME SYNC
//  Cloud is always the source of truth when signed in.
//  Local tasks are only pushed on first sign-in (when cloud is empty).
// ══════════════════════════════════════════════════════════
function startSync(uid) {
  if (liveRef) { off(liveRef); liveRef = null; }
  liveRef = ref(fbDb, `users/${uid}/tasks`);

  let firstSnapshot = true;

  // Track network state for status indicator
  window.addEventListener("offline", () => setSyncStatus("local", "Offline"));
  window.addEventListener("online",  () => setSyncStatus("saving", "Reconnecting…"));

  onValue(liveRef, (snap) => {
    const remote = snap.val();

    if (firstSnapshot) {
      firstSnapshot = false;
      if (Array.isArray(remote) && remote.length) {
        // Cloud has data → cloud replaces local completely
        tasks = remote.slice().sort((a, b) => b.createdAt - a.createdAt);
        saveLocal();
      } else if (tasks.length) {
        // Cloud is empty but local has tasks → upload once
        pushCloud(uid);
        return;
      }
    } else {
      // All subsequent real-time updates: cloud is authoritative
      // This means deletions from Firebase Console are respected immediately
      tasks = Array.isArray(remote)
        ? remote.slice().sort((a, b) => b.createdAt - a.createdAt)
        : [];
      saveLocal();
    }

    render(); updateStats(); updateSubText();
    setSyncStatus("live", "Synced ✓");
  }, (err) => {
    setSyncStatus("error", "Sync error");
    toast("Sync error: " + err.message, "er");
  });
}

function pushCloud(uid) {
  if (!fbDb || !uid) return Promise.resolve();
  if (!navigator.onLine) {
    // Offline — saved locally, Firebase SDK will retry automatically
    setSyncStatus("local", "Offline — saved locally");
    return Promise.resolve();
  }
  setSyncStatus("saving", "Saving…");
  return set(ref(fbDb, `users/${uid}/tasks`), tasks)
    .then(() => { setSyncStatus("live", "Synced ✓"); updateSubText(); })
    .catch(() => { setSyncStatus("error", "Failed"); toast("Save failed", "er"); });
}

// ══════════════════════════════════════════════════════════
//  BACKUP & RESTORE
// ══════════════════════════════════════════════════════════
g("btnBackup").onclick = async () => {
  if (!user || !fbDb) return;
  setSyncStatus("saving", "Backing up…");
  try {
    await set(ref(fbDb, `users/${user.uid}/backup`), {
      tasks,
      backedUpAt: Date.now(),
      count: tasks.length
    });
    const ts = new Date().toLocaleString();
    localStorage.setItem(LS_BACKUP, ts);
    setSyncStatus("live", "Synced ✓");
    updateSubText();
    toast(`✓ ${tasks.length} tasks backed up to your Google account`, "ok");
  } catch (e) {
    setSyncStatus("error", "Error");
    toast("Backup failed: " + e.message, "er");
  }
};

g("btnRestore").onclick = async () => {
  if (!user || !fbDb) return;
  setSyncStatus("saving", "Restoring…");
  try {
    const snap = await get(ref(fbDb, `users/${user.uid}/backup`));
    const data = snap.val();
    if (!data?.tasks?.length) {
      setSyncStatus("live", "Synced ✓");
      toast("No backup found for your account yet.", "in");
      return;
    }
    // Restore replaces current tasks entirely, then pushes to cloud
    tasks = data.tasks.slice().sort((a, b) => b.createdAt - a.createdAt);
    saveLocal();
    await pushCloud(user.uid);
    render(); updateStats(); updateSubText();
    const ts = new Date(data.backedUpAt).toLocaleString();
    toast(`✓ Restored ${data.tasks.length} tasks (backed up ${ts})`, "ok");
  } catch (e) {
    setSyncStatus("error", "Error");
    toast("Restore failed: " + e.message, "er");
  }
};

// ══════════════════════════════════════════════════════════
//  TASK CRUD
// ══════════════════════════════════════════════════════════
function addTask() {
  const inp  = g("taskInput");
  const text = inp.value.trim();
  if (!text) return;
  tasks.unshift({
    id:        mkId(),
    text,
    done:      false,
    category:  cat,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  inp.value = "";
  commit();
}

// Exposed to inline onclick handlers in rendered HTML
window._tog = (id) => {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.done      = !t.done;
  t.updatedAt = Date.now();
  commit();
};

window._del = (id) => {
  tasks = tasks.filter(x => x.id !== id);
  commit();
};

function commit() {
  saveLocal();
  render();
  updateStats();
  if (user) pushCloud(user.uid);
}

// ══════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════
const CAT_LABELS = {
  work:     "💼 Work",
  personal: "🏠 Personal",
  shopping: "🛒 Shopping",
  health:   "💪 Health",
  study:    "📚 Study"
};

const EMPTY_MESSAGES = {
  all:    ["Nothing here yet",  "Type a task above and hit Enter ↑"],
  active: ["All clear!",        "No active tasks."],
  done:   ["Nothing done yet",  "Check off some tasks."]
};

function render() {
  const list = g("taskList");
  const vis  = tasks.filter(t =>
    !(filter === "active" && t.done) &&
    !(filter === "done"   && !t.done)
  );

  if (!vis.length) {
    const [h, p] = EMPTY_MESSAGES[filter];
    list.innerHTML = `
      <li class="empty">
        <div class="empty-icon">${filter === "done" ? "✅" : "📋"}</div>
        <h3>${h}</h3>
        <p>${p}</p>
      </li>`;
    return;
  }

  list.innerHTML = vis.map(t => {
    const dateStr = new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const catTag  = t.category
      ? `<span class="task-cat">${CAT_LABELS[t.category] || t.category}</span>`
      : "";
    return `
      <li class="task${t.done ? " done" : ""}">
        <div class="chk${t.done ? " done" : ""}" onclick="_tog('${t.id}')"></div>
        <div class="task-body">
          <div class="task-txt">${esc(t.text)}</div>
          <div class="task-meta">
            <span class="task-date">${dateStr}</span>
            ${catTag}
          </div>
        </div>
        <div class="task-btns">
          <button class="tbtn del" onclick="_del('${t.id}')" title="Delete">✕</button>
        </div>
      </li>`;
  }).join("");
}

function updateStats() {
  const total = tasks.length;
  const done  = tasks.filter(t => t.done).length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  g("progFill").style.width = pct + "%";
  g("progTxt").textContent  = `${total} task${total !== 1 ? "s" : ""}`;
  g("progPct").textContent  = total ? `${pct}% done` : "—";
}

function updateSubText() {
  const ts = localStorage.getItem(LS_BACKUP);
  g("sbSub").innerHTML = ts
    ? `Auto-syncing · Last backup: <b>${ts}</b>`
    : `Tasks sync automatically to your account`;
}

// ══════════════════════════════════════════════════════════
//  MODAL
// ══════════════════════════════════════════════════════════
function openModal()  { g("signInModal").classList.add("open"); }
function closeModal() { g("signInModal").classList.remove("open"); }

// ══════════════════════════════════════════════════════════
//  EVENT WIRING
// ══════════════════════════════════════════════════════════
g("btnAdd").onclick   = addTask;
g("btnDoSignIn").onclick    = doSignIn;
g("modalClose").onclick     = closeModal;
g("btnHeaderSignIn").onclick = openModal;
g("btnPromoSignIn").onclick  = openModal;

g("taskInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTask();
});

g("signInModal").addEventListener("click", (e) => {
  if (e.target === g("signInModal")) closeModal();
});

// Category pills
g("cats").addEventListener("click", (e) => {
  const btn = e.target.closest(".cat");
  if (!btn) return;
  document.querySelectorAll(".cat").forEach(b => b.classList.remove("on"));
  btn.classList.add("on");
  cat = btn.dataset.c;
});

// Filter tabs
document.querySelector(".filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".filt");
  if (!btn) return;
  filter = btn.dataset.f;
  document.querySelectorAll(".filt").forEach(b => b.classList.remove("on"));
  btn.classList.add("on");
  render();
});

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function setSyncStatus(state, label) {
  g("syncDot").className    = "sync-dot " + state;
  g("syncLbl").textContent  = label;
}

function saveLocal() {
  localStorage.setItem(LS_TASKS, JSON.stringify(tasks));
}

function hideLoader() {
  g("loadScr").classList.add("gone");
}

function g(id) {
  return document.getElementById(id);
}

function mkId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg, type = "in") {
  const icons = { ok: "✓", er: "✕", in: "◆" };
  const el    = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="ti">${icons[type]}</span><span>${msg}</span>`;
  g("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
