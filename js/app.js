(function () {
  "use strict";

  var STORAGE_KEY = "canteen_residents_v1";
  var CHOICES_KEY = "canteen_meal_choices_v1";

  function uid() {
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function normalizeResident(p) {
    if (!p || typeof p !== "object") return null;
    var id = p.id || uid();
    var name = typeof p.name === "string" ? p.name.trim() : "";
    return { id: id, name: name };
  }

  function normalizeResidentList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(normalizeResident).filter(function (x) {
      return x && x.name;
    });
  }

  function loadResidents() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          return normalizeResidentList(parsed);
        }
      }
    } catch (e) {}
    return null;
  }

  function saveResidents(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  /** 当日餐别：仅保存「非默认」；默认 L+D 不写键 */
  function loadChoicesMap() {
    try {
      var raw = localStorage.getItem(CHOICES_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      if (o && o.day === todayStr() && o.map && typeof o.map === "object") return o.map;
    } catch (e) {}
    return {};
  }

  function persistChoices() {
    var map = state.choices;
    var cleaned = {};
    Object.keys(map).forEach(function (id) {
      var m = map[id];
      if (m && m !== "LD") cleaned[id] = m;
    });
    localStorage.setItem(
      CHOICES_KEY,
      JSON.stringify({ day: todayStr(), map: cleaned })
    );
  }

  function setChoiceForPerson(id, meal) {
    if (!id) return;
    if (!meal || meal === "LD") {
      delete state.choices[id];
    } else {
      state.choices[id] = meal;
    }
    persistChoices();
  }

  function getMealForPerson(id) {
    if (!id) return "LD";
    var m = state.choices[id];
    return m && m !== "LD" ? m : "LD";
  }

  function fetchSeed() {
    return fetch("residents.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("residents.json");
        return r.json();
      })
      .catch(function () {
        return [];
      });
  }

  function parseVisitorExpr(s) {
    if (!s || typeof s !== "string") return { L: 0, D: 0 };
    var t = s.replace(/\s/g, "").toUpperCase();
    var L = 0;
    var D = 0;
    var re = /(\d*)([LD])/g;
    var m;
    while ((m = re.exec(t)) !== null) {
      var n = m[1] ? parseInt(m[1], 10) : 1;
      if (m[2] === "L") L += n;
      else D += n;
    }
    return { L: L, D: D };
  }

  function mealToContribution(meal) {
    if (meal === "leave") return { L: 0, D: 0 };
    if (meal === "L") return { L: 1, D: 0 };
    if (meal === "D") return { L: 0, D: 1 };
    return { L: 1, D: 1 };
  }

  function computeStats(residents, visitorExpr) {
    var L = 0;
    var D = 0;
    residents.forEach(function (p) {
      var meal = getMealForPerson(p.id);
      var c = mealToContribution(meal);
      L += c.L;
      D += c.D;
    });
    var v = parseVisitorExpr(visitorExpr);
    L += v.L;
    D += v.D;
    return { L: L, D: D };
  }

  var els = {
    statsL: document.getElementById("statsL"),
    statsD: document.getElementById("statsD"),
    statsTime: document.getElementById("statsTime"),
    residentSelect: document.getElementById("residentSelect"),
    mealSelect: document.getElementById("mealSelect"),
    leaveExtra: document.getElementById("leaveExtra"),
    leaveStart: document.getElementById("leaveStart"),
    leaveEnd: document.getElementById("leaveEnd"),
    visitorInput: document.getElementById("visitorInput"),
    btnEditResidents: document.getElementById("btnEditResidents"),
    modalBackdrop: document.getElementById("modalBackdrop"),
    modalClose: document.getElementById("modalClose"),
    editList: document.getElementById("editList"),
    btnAddRow: document.getElementById("btnAddRow"),
    btnSaveResidents: document.getElementById("btnSaveResidents"),
    btnResetResidents: document.getElementById("btnResetResidents"),
    btnCancelModal: document.getElementById("btnCancelModal"),
  };

  var state = {
    residents: [],
    seed: [],
    choices: {},
    editSnapshot: null,
  };

  function mealLabel(meal) {
    if (meal === "leave") return "Leave";
    if (meal === "L") return "仅L";
    if (meal === "D") return "仅D";
    return "L+D";
  }

  function renderResidentOptions() {
    var sel = els.residentSelect;
    var prev = sel.value;
    sel.innerHTML = "";
    var opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "请选择人员";
    sel.appendChild(opt0);
    state.residents.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      var m = getMealForPerson(p.id);
      o.textContent = p.name + " · " + mealLabel(m);
      sel.appendChild(o);
    });
    if (prev && state.residents.some(function (x) { return x.id === prev; })) {
      sel.value = prev;
    }
  }

  function syncMealSelectToChoice() {
    var id = els.residentSelect.value;
    var meal = els.mealSelect;
    if (!id) {
      meal.value = "LD";
      toggleLeave(false);
      return;
    }
    var m = getMealForPerson(id);
    meal.value = m === "leave" ? "leave" : m === "L" ? "L" : m === "D" ? "D" : "LD";
    toggleLeave(meal.value === "leave");
  }

  function toggleLeave(show) {
    els.leaveExtra.classList.toggle("is-visible", show);
  }

  function updateStats() {
    var v = els.visitorInput ? els.visitorInput.value : "";
    var s = computeStats(state.residents, v);
    els.statsL.textContent = s.L + "L";
    els.statsD.textContent = s.D + "D";
    els.statsTime.textContent = "更新于 " + formatNow();
  }

  function formatNow() {
    var d = new Date();
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes()) +
      ":" +
      pad(d.getSeconds())
    );
  }

  function openModal() {
    try {
      state.editSnapshot = JSON.stringify(state.residents);
    } catch (e) {
      state.editSnapshot = "[]";
    }
    els.modalBackdrop.classList.add("is-open");
    renderEditList();
  }

  function closeModal(restore) {
    if (restore && state.editSnapshot != null) {
      try {
        state.residents = JSON.parse(state.editSnapshot);
      } catch (e) {}
    }
    state.editSnapshot = null;
    els.modalBackdrop.classList.remove("is-open");
  }

  function renderEditList() {
    var container = els.editList;
    container.innerHTML = "";
    if (!state.residents.length) {
      container.innerHTML = '<p class="empty-edit">暂无人员，点击「添加一行」</p>';
      return;
    }
    state.residents.forEach(function (p, index) {
      var row = document.createElement("div");
      row.className = "edit-row";
      row.dataset.id = p.id;

      var nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "姓名";
      nameInput.value = p.name || "";
      nameInput.setAttribute("aria-label", "姓名 " + (index + 1));

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-danger btn-small";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", function () {
        var pid = p.id;
        state.residents = state.residents.filter(function (x) {
          return x.id !== pid;
        });
        delete state.choices[pid];
        persistChoices();
        renderEditList();
        updateStats();
      });

      row.appendChild(nameInput);
      row.appendChild(delBtn);
      container.appendChild(row);
    });
  }

  function collectEditList() {
    var rows = els.editList.querySelectorAll(".edit-row");
    var list = [];
    rows.forEach(function (row) {
      var nameInput = row.querySelector('input[type="text"]');
      var name = (nameInput && nameInput.value.trim()) || "";
      if (!name) return;
      var id = row.dataset.id || uid();
      list.push({ id: id, name: name });
    });
    return list;
  }

  function pruneChoicesForResidents(residents) {
    var ids = {};
    residents.forEach(function (p) {
      ids[p.id] = true;
    });
    Object.keys(state.choices).forEach(function (id) {
      if (!ids[id]) delete state.choices[id];
    });
    persistChoices();
  }

  function init() {
    fetchSeed().then(function (seed) {
      state.seed = normalizeResidentList(seed);
      var stored = loadResidents();
      state.residents =
        stored && stored.length ? stored : state.seed.slice();
      if (!state.residents.length && state.seed.length) {
        state.residents = state.seed.slice();
      }
      state.choices = loadChoicesMap();
      pruneChoicesForResidents(state.residents);
      renderResidentOptions();
      syncMealSelectToChoice();
      updateStats();
    });

    els.residentSelect.addEventListener("change", function () {
      renderResidentOptions();
      syncMealSelectToChoice();
    });

    els.mealSelect.addEventListener("change", function () {
      var id = els.residentSelect.value;
      var val = els.mealSelect.value;
      toggleLeave(val === "leave");
      if (!id) return;
      setChoiceForPerson(id, val);
      renderResidentOptions();
      updateStats();
    });

    if (els.visitorInput) {
      els.visitorInput.addEventListener("input", updateStats);
    }

    els.btnEditResidents.addEventListener("click", openModal);
    els.modalClose.addEventListener("click", function () {
      closeModal(true);
    });
    els.btnCancelModal.addEventListener("click", function () {
      closeModal(true);
    });
    els.modalBackdrop.addEventListener("click", function (e) {
      if (e.target === els.modalBackdrop) closeModal(true);
    });

    els.btnAddRow.addEventListener("click", function () {
      state.residents.push({ id: uid(), name: "" });
      renderEditList();
    });

    els.btnSaveResidents.addEventListener("click", function () {
      state.residents = collectEditList();
      pruneChoicesForResidents(state.residents);
      saveResidents(state.residents);
      renderResidentOptions();
      syncMealSelectToChoice();
      updateStats();
      closeModal(false);
    });

    els.btnResetResidents.addEventListener("click", function () {
      if (!confirm("确定恢复为初始名单（residents.json）？本地编辑与今日餐别将重置。")) return;
      if (!state.seed.length) {
        fetchSeed().then(function (s) {
          state.seed = normalizeResidentList(s);
          applySeedReset();
        });
        return;
      }
      applySeedReset();
    });

    function applySeedReset() {
      state.residents = state.seed.slice();
      state.choices = {};
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CHOICES_KEY);
      saveResidents(state.residents);
      renderResidentOptions();
      syncMealSelectToChoice();
      updateStats();
      renderEditList();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
