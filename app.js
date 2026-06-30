const STORAGE_KEY = "medication-learning-mobile-v1";
const FIELD_TYPES = new Set(["textarea", "text", "number", "date", "url"]);

const DEFAULT_FIELDS = [
  { id: "drugName", label: "薬の名前", type: "text", required: true, protected: true, quiz: false },
  { id: "disease", label: "使用する疾患", type: "textarea", required: false, quiz: true },
  { id: "effect", label: "作用", type: "textarea", required: false, quiz: true },
  { id: "seriousAdverse", label: "副作用（重篤）", type: "textarea", required: false, quiz: true },
  { id: "otherAdverse", label: "副作用（重篤でないもの）", type: "textarea", required: false, quiz: true },
  { id: "dailyObservation", label: "毎日観察する項目（看護師の立場）", type: "textarea", required: false, quiz: true },
  { id: "duration", label: "作用時間", type: "text", required: false, quiz: true },
  { id: "tmax", label: "最大血中濃度になる時間（Tmax）", type: "text", required: false, quiz: true },
  { id: "prnInterval", label: "頓服時に空ける時間", type: "text", required: false, quiz: true },
  { id: "sourceUrl", label: "参照元URL", type: "url", required: false, quiz: false },
  { id: "verifiedAt", label: "最終確認日", type: "date", required: false, quiz: false }
];

let state = loadState();
let currentStatusFilter = "all";
let favoritesOnly = false;
let editingRecordId = null;
let quiz = null;
let saveTimer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function createInitialState() {
  return { version: 1, fields: structuredClone(DEFAULT_FIELDS), records: [], updatedAt: new Date().toISOString() };
}

function normalizeState(data) {
  const sourceFields = Array.isArray(data.fields) ? data.fields : [];
  const fields = sourceFields.map((field, index) => {
    const id = String(field.id || uid("field")).replace(/[^a-zA-Z0-9_-]/g, "_");
    return {
      id,
      label: String(field.label || `項目 ${index + 1}`).slice(0, 80),
      type: FIELD_TYPES.has(field.type) ? field.type : "textarea",
      required: id === "drugName",
      protected: id === "drugName",
      quiz: id === "drugName" ? false : Boolean(field.quiz)
    };
  });
  if (!fields.some((field) => field.id === "drugName")) fields.unshift(structuredClone(DEFAULT_FIELDS[0]));

  const validIds = new Set(fields.map((field) => field.id));
  const records = (Array.isArray(data.records) ? data.records : []).map((record) => {
    const values = {};
    Object.entries(record.values || {}).forEach(([key, value]) => {
      if (validIds.has(key)) values[key] = String(value ?? "");
    });
    return {
      id: String(record.id || uid("drug")).replace(/[^a-zA-Z0-9_-]/g, "_"),
      values,
      status: ["new", "learning", "mastered"].includes(record.status) ? record.status : "new",
      favorite: Boolean(record.favorite),
      quizStats: record.quizStats && typeof record.quizStats === "object" ? record.quizStats : {}
    };
  });
  return { version: 1, fields, records, updatedAt: data.updatedAt || new Date().toISOString() };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.fields) && Array.isArray(saved.records)) return normalizeState(saved);
  } catch (error) {
    console.warn("保存データを読み込めませんでした", error);
  }
  return createInitialState();
}

function persist(message = "自動保存しました") {
  state.updatedAt = new Date().toISOString();
  $("#saveStatus").textContent = "保存中...";
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveTimer = setTimeout(() => {
      $("#saveStatus").textContent = "保存済み";
    }, 120);
  } catch {
    $("#saveStatus").textContent = "保存失敗";
    showToast("保存できませんでした。空き容量を確認してください");
    return;
  }
  if (message) showToast(message);
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"]/g, (match) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[match]));
}

function safeUrl(value = "") {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function statusLabel(status) {
  return { new: "未学習", learning: "学習中", mastered: "覚えた" }[status] || "未学習";
}

function switchView(viewId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  if (viewId === "quizView") renderQuizSetup();
  if (viewId === "editView") renderEditor();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function switchEditPanel(panelId) {
  $$(".edit-panel").forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
  $$(".subtab").forEach((button) => button.classList.toggle("active", button.dataset.editPanel === panelId));
}

function renderLearn() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const filtered = state.records.filter((record) => {
    const values = Object.values(record.values || {}).join(" ").toLowerCase();
    return (!query || values.includes(query)) &&
      (currentStatusFilter === "all" || record.status === currentStatusFilter) &&
      (!favoritesOnly || record.favorite);
  });

  const mastered = state.records.filter((record) => record.status === "mastered").length;
  $("#recordSummary").textContent = `${filtered.length}件を表示 / 全${state.records.length}件 / 覚えた ${mastered}件`;
  const list = $("#drugList");

  if (!filtered.length) {
    list.innerHTML = state.records.length
      ? `<div class="empty-state"><strong>該当する薬剤がありません</strong>検索条件を変更してください。</div>`
      : `<div class="empty-state"><strong>薬剤はまだ登録されていません</strong>最初の薬剤情報を追加してください。<button class="primary compact" type="button" data-empty-add>薬を追加</button></div>`;
    list.querySelector("[data-empty-add]")?.addEventListener("click", openNewDrugForm);
    return;
  }

  const diseaseField = state.fields.find((field) => field.id === "disease") || state.fields[1];
  const effectField = state.fields.find((field) => field.id === "effect") || state.fields.find((field) => !field.protected);

  list.innerHTML = filtered.map((record) => {
    const name = record.values.drugName || "名称未入力";
    const disease = diseaseField ? record.values[diseaseField.id] : "";
    const effect = effectField ? record.values[effectField.id] : "";
    return `<article class="drug-card" data-record-id="${record.id}">
      <div class="drug-card-head">
        <div>
          <h3>${escapeHtml(name)}</h3>
          <p class="drug-disease">${escapeHtml(disease || "使用疾患 未入力")}</p>
        </div>
        <button class="favorite-button ${record.favorite ? "active" : ""}" type="button" data-favorite aria-label="お気に入り切替">${record.favorite ? "★" : "☆"}</button>
      </div>
      ${effectField ? `<span class="preview-label">${escapeHtml(effectField.label)}</span><p class="preview-value">${escapeHtml(effect || "未入力")}</p>` : ""}
      <div class="card-footer">
        <select class="status-select" data-status-select aria-label="習得状態">
          ${["new", "learning", "mastered"].map((status) => `<option value="${status}" ${record.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
        </select>
        <button class="text-button" type="button" data-detail>詳しく見る</button>
      </div>
    </article>`;
  }).join("");

  list.querySelectorAll(".drug-card").forEach((card) => {
    const record = state.records.find((item) => item.id === card.dataset.recordId);
    card.querySelector("[data-favorite]").addEventListener("click", () => {
      record.favorite = !record.favorite;
      persist(record.favorite ? "お気に入りに追加しました" : "お気に入りを外しました");
      renderLearn();
    });
    card.querySelector("[data-status-select]").addEventListener("change", (event) => {
      record.status = event.target.value;
      persist("習得状態を更新しました");
      renderLearn();
    });
    card.querySelector("[data-detail]").addEventListener("click", () => openDetail(record.id));
  });
}

function openDetail(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return;
  const fields = state.fields.filter((field) => record.values[field.id]);
  $("#detailContent").innerHTML = `<div class="detail-title-row">
    <div><span class="section-kicker">MEDICATION</span><h2>${escapeHtml(record.values.drugName)}</h2></div>
    <button class="favorite-button ${record.favorite ? "active" : ""}" type="button" data-detail-favorite>${record.favorite ? "★" : "☆"}</button>
  </div>
  <dl>${fields.filter((field) => field.id !== "drugName").map((field) => {
    const value = record.values[field.id];
    const url = field.type === "url" ? safeUrl(value) : "";
    return `<div class="detail-field"><dt>${escapeHtml(field.label)}</dt><dd>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">参照元を開く</a>` : escapeHtml(value)}</dd></div>`;
  }).join("") || `<div class="detail-field"><dd>詳細はまだ入力されていません。</dd></div>`}</dl>
  <button class="text-button full" type="button" data-detail-edit>この薬剤を編集</button>`;
  $("#detailContent").querySelector("[data-detail-favorite]").addEventListener("click", () => {
    record.favorite = !record.favorite;
    persist("お気に入りを更新しました");
    $("#detailDialog").close();
    renderLearn();
  });
  $("#detailContent").querySelector("[data-detail-edit]").addEventListener("click", () => {
    $("#detailDialog").close();
    editRecord(record.id);
  });
  $("#detailDialog").showModal();
}

function openNewDrugForm() {
  editingRecordId = null;
  switchView("editView");
  switchEditPanel("recordsPanel");
  renderDrugForm();
  $("#drugForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderEditor() {
  renderDrugForm();
  renderEditDrugList();
  renderFieldList();
}

function renderDrugForm() {
  const record = editingRecordId ? state.records.find((item) => item.id === editingRecordId) : null;
  $("#formTitle").textContent = record ? "薬剤を編集" : "薬剤を追加";
  $("#cancelEditButton").classList.toggle("hidden", !record);
  $("#dynamicFields").innerHTML = state.fields.map((field) => {
    const value = record?.values?.[field.id] || "";
    const attrs = `${field.required ? "required" : ""} data-field-id="${field.id}"`;
    const control = field.type === "textarea"
      ? `<textarea ${attrs}>${escapeHtml(value)}</textarea>`
      : `<input type="${field.type}" value="${escapeHtml(value)}" ${attrs}>`;
    return `<div class="dynamic-field"><label>${escapeHtml(field.label)}${field.required ? " *" : ""}${control}</label></div>`;
  }).join("");
}

function renderEditDrugList() {
  $("#editRecordCount").textContent = `${state.records.length}件`;
  const list = $("#editDrugList");
  if (!state.records.length) {
    list.innerHTML = `<div class="empty-state">登録済みの薬剤はありません。</div>`;
    return;
  }
  list.innerHTML = state.records.map((record) => `<div class="edit-drug-item" data-record-id="${record.id}">
    <strong>${escapeHtml(record.values.drugName || "名称未入力")}</strong>
    <div class="edit-item-actions">
      <button class="small-button" type="button" data-edit>編集</button>
      <button class="small-button" type="button" data-copy>複製</button>
      <button class="small-button delete" type="button" data-delete>削除</button>
    </div>
  </div>`).join("");
  list.querySelectorAll(".edit-drug-item").forEach((item) => {
    const id = item.dataset.recordId;
    item.querySelector("[data-edit]").addEventListener("click", () => editRecord(id));
    item.querySelector("[data-copy]").addEventListener("click", () => copyRecord(id));
    item.querySelector("[data-delete]").addEventListener("click", () => deleteRecord(id));
  });
}

function editRecord(id) {
  editingRecordId = id;
  switchView("editView");
  switchEditPanel("recordsPanel");
  renderDrugForm();
  $("#drugForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function copyRecord(id) {
  const source = state.records.find((record) => record.id === id);
  if (!source) return;
  const copy = structuredClone(source);
  copy.id = uid("drug");
  copy.values.drugName = `${copy.values.drugName}（複製）`;
  copy.status = "new";
  copy.favorite = false;
  copy.quizStats = {};
  state.records.unshift(copy);
  persist("薬剤を複製しました");
  renderAll();
}

function deleteRecord(id) {
  const record = state.records.find((item) => item.id === id);
  if (!record || !confirm(`「${record.values.drugName}」を削除しますか？`)) return;
  state.records = state.records.filter((item) => item.id !== id);
  if (editingRecordId === id) editingRecordId = null;
  persist("薬剤を削除しました");
  renderAll();
}

function saveDrug(event) {
  event.preventDefault();
  const values = {};
  $$("#dynamicFields [data-field-id]").forEach((input) => { values[input.dataset.fieldId] = input.value.trim(); });
  if (!values.drugName) return;
  const existing = state.records.find((record) => record.id === editingRecordId);
  if (existing) {
    existing.values = values;
  } else {
    state.records.unshift({ id: uid("drug"), values, status: "new", favorite: false, quizStats: {} });
  }
  persist(existing ? "薬剤情報を更新しました" : "薬剤を追加しました");
  editingRecordId = null;
  event.target.reset();
  renderAll();
}

function renderFieldList() {
  const list = $("#fieldList");
  list.innerHTML = state.fields.map((field, index) => `<div class="field-item" data-field-id="${field.id}">
    <span class="field-key">${field.protected ? "必須項目" : `項目 ${index + 1}`}</span>
    <div class="field-item-grid">
      <input type="text" value="${escapeHtml(field.label)}" data-field-label ${field.protected ? "disabled" : ""} aria-label="項目名">
      <select data-field-type ${field.protected ? "disabled" : ""} aria-label="入力形式">
        ${[["textarea", "複数行"], ["text", "1行"], ["number", "数値"], ["date", "日付"], ["url", "URL"]].map(([value, label]) => `<option value="${value}" ${field.type === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </div>
    <label class="toggle-line"><input type="checkbox" data-field-quiz ${field.quiz ? "checked" : ""} ${field.protected ? "disabled" : ""}><span>確認問題に使う</span></label>
    <div class="field-actions">
      <button class="small-button" type="button" data-move="up" ${index === 0 ? "disabled" : ""}>上へ</button>
      <button class="small-button" type="button" data-move="down" ${index === state.fields.length - 1 ? "disabled" : ""}>下へ</button>
      ${field.protected ? "" : `<button class="small-button delete" type="button" data-field-delete>削除</button>`}
    </div>
  </div>`).join("");

  list.querySelectorAll(".field-item").forEach((item) => {
    const id = item.dataset.fieldId;
    item.querySelector("[data-field-label]")?.addEventListener("change", (event) => updateField(id, { label: event.target.value.trim() }));
    item.querySelector("[data-field-type]")?.addEventListener("change", (event) => updateField(id, { type: event.target.value }));
    item.querySelector("[data-field-quiz]")?.addEventListener("change", (event) => updateField(id, { quiz: event.target.checked }));
    item.querySelectorAll("[data-move]").forEach((button) => button.addEventListener("click", () => moveField(id, button.dataset.move)));
    item.querySelector("[data-field-delete]")?.addEventListener("click", () => deleteField(id));
  });
}

function updateField(id, changes) {
  const field = state.fields.find((item) => item.id === id);
  if (!field) return;
  if ("label" in changes && !changes.label) { renderFieldList(); return showToast("項目名を入力してください"); }
  Object.assign(field, changes);
  persist("項目を更新しました");
  renderAll();
}

function moveField(id, direction) {
  const index = state.fields.findIndex((field) => field.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= state.fields.length) return;
  [state.fields[index], state.fields[target]] = [state.fields[target], state.fields[index]];
  persist("項目の順番を変更しました");
  renderAll();
}

function deleteField(id) {
  const field = state.fields.find((item) => item.id === id);
  if (!field || field.protected || !confirm(`項目「${field.label}」と、全薬剤に入力された内容を削除しますか？`)) return;
  state.fields = state.fields.filter((item) => item.id !== id);
  state.records.forEach((record) => delete record.values[id]);
  persist("項目を削除しました");
  renderAll();
}

function addField(event) {
  event.preventDefault();
  const label = $("#newFieldLabel").value.trim();
  if (!label) return;
  state.fields.push({ id: uid("field"), label, type: $("#newFieldType").value, required: false, quiz: $("#newFieldQuiz").checked });
  event.target.reset();
  $("#newFieldQuiz").checked = true;
  persist("項目を追加しました");
  renderAll();
}

function renderQuizSetup() {
  const fields = state.fields.filter((field) => field.quiz && !field.protected);
  $("#quizField").innerHTML = fields.length
    ? `<option value="random">ランダム</option>${fields.map((field) => `<option value="${field.id}">${escapeHtml(field.label)}</option>`).join("")}`
    : `<option value="">出題できる項目がありません</option>`;
  $("#startQuizButton").disabled = !fields.length || !state.records.length;
}

function startQuiz() {
  const includeMastered = $("#quizMastered").checked;
  const fields = state.fields.filter((field) => field.quiz && !field.protected);
  const selectedField = $("#quizField").value;
  const records = state.records.filter((record) => {
    const inScope = includeMastered || record.status !== "mastered";
    const hasAnswer = selectedField === "random"
      ? fields.some((field) => record.values[field.id])
      : Boolean(record.values[selectedField]);
    return inScope && hasAnswer;
  });
  if (!records.length || !fields.length) {
    $("#quizSetup").classList.add("hidden");
    $("#quizEmpty").classList.remove("hidden");
    $("#quizEmpty").innerHTML = `<strong>出題できるデータがありません</strong>薬剤を登録するか、「覚えた」薬も出題する設定にしてください。`;
    return;
  }
  quiz = {
    records: [...records].sort(() => Math.random() - .5),
    fields,
    selectedField,
    index: 0,
    correct: 0,
    attempts: 0,
    currentField: null
  };
  $("#quizSetup").classList.add("hidden");
  $("#quizEmpty").classList.add("hidden");
  $("#quizResult").classList.add("hidden");
  $("#quizCard").classList.remove("hidden");
  showQuestion();
}

function showQuestion() {
  if (!quiz || quiz.index >= quiz.records.length) return finishQuiz();
  const record = quiz.records[quiz.index];
  const available = quiz.fields.filter((field) => record.values[field.id]);
  let field = quiz.selectedField === "random"
    ? available[Math.floor(Math.random() * available.length)]
    : quiz.fields.find((item) => item.id === quiz.selectedField);
  field ||= quiz.fields.find((item) => record.values[item.id]) || quiz.fields[0];
  quiz.currentField = field;
  $("#quizCount").textContent = `${quiz.index + 1} / ${quiz.records.length}`;
  $("#quizProgress").style.width = `${((quiz.index + 1) / quiz.records.length) * 100}%`;
  $("#quizPrompt").textContent = `${field.label}を答えてください`;
  $("#quizDrugName").textContent = record.values.drugName;
  $("#quizAnswer").textContent = record.values[field.id] || "未入力";
  $("#quizAnswer").classList.add("hidden");
  $("#quizJudge").classList.add("hidden");
  $("#revealAnswerButton").classList.remove("hidden");
}

function revealAnswer() {
  $("#quizAnswer").classList.remove("hidden");
  $("#quizJudge").classList.remove("hidden");
  $("#revealAnswerButton").classList.add("hidden");
}

function judgeAnswer(correct) {
  if (!quiz) return;
  const record = quiz.records[quiz.index];
  const fieldId = quiz.currentField.id;
  record.quizStats ||= {};
  record.quizStats[fieldId] ||= { attempts: 0, correct: 0 };
  record.quizStats[fieldId].attempts += 1;
  record.quizStats[fieldId].correct += correct ? 1 : 0;
  quiz.attempts += 1;
  quiz.correct += correct ? 1 : 0;
  quiz.index += 1;
  persist("");
  showQuestion();
}

function finishQuiz() {
  if (!quiz) return;
  $("#quizCard").classList.add("hidden");
  const rate = quiz.attempts ? Math.round((quiz.correct / quiz.attempts) * 100) : 0;
  $("#quizResult").classList.remove("hidden");
  $("#quizResult").innerHTML = `<span class="section-kicker">RESULT</span><h3>確認終了</h3><p>覚えていた ${quiz.correct} / ${quiz.attempts}問（${rate}%）</p><button class="primary full" type="button" data-restart>もう一度確認する</button>`;
  $("#quizResult [data-restart]").addEventListener("click", resetQuiz);
  quiz = null;
}

function resetQuiz() {
  quiz = null;
  $("#quizCard").classList.add("hidden");
  $("#quizResult").classList.add("hidden");
  $("#quizEmpty").classList.add("hidden");
  $("#quizSetup").classList.remove("hidden");
  renderQuizSetup();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kusuri-note-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("バックアップを書き出しました");
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.fields) || !Array.isArray(imported.records)) throw new Error("invalid");
    if (!confirm("現在のデータを、読み込んだバックアップで置き換えますか？")) return;
    state = normalizeState(imported);
    editingRecordId = null;
    persist("バックアップを復元しました");
    renderAll();
  } catch {
    alert("このファイルは読み込めません。くすりノートから書き出したJSONを選んでください。");
  } finally {
    event.target.value = "";
  }
}

function resetData() {
  if (!confirm("すべてのデータを初期化します。この操作は元に戻せません。")) return;
  state = createInitialState();
  editingRecordId = null;
  persist("データを初期化しました");
  renderAll();
}

function renderAll() {
  renderLearn();
  renderQuizSetup();
  renderEditor();
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$(".subtab").forEach((button) => button.addEventListener("click", () => switchEditPanel(button.dataset.editPanel)));
  $$(".filter-chip").forEach((button) => button.addEventListener("click", () => {
    currentStatusFilter = button.dataset.status;
    $$(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
    renderLearn();
  }));
  $("#searchInput").addEventListener("input", renderLearn);
  $("#favoriteFilter").addEventListener("click", (event) => {
    favoritesOnly = !favoritesOnly;
    event.currentTarget.setAttribute("aria-pressed", String(favoritesOnly));
    event.currentTarget.textContent = favoritesOnly ? "★" : "☆";
    renderLearn();
  });
  $("#quickAddButton").addEventListener("click", openNewDrugForm);
  $("#closeDetailButton").addEventListener("click", () => $("#detailDialog").close());
  $("#drugForm").addEventListener("submit", saveDrug);
  $("#cancelEditButton").addEventListener("click", () => { editingRecordId = null; renderDrugForm(); });
  $("#fieldForm").addEventListener("submit", addField);
  $("#startQuizButton").addEventListener("click", startQuiz);
  $("#revealAnswerButton").addEventListener("click", revealAnswer);
  $("#retryButton").addEventListener("click", () => judgeAnswer(false));
  $("#correctButton").addEventListener("click", () => judgeAnswer(true));
  $("#endQuizButton").addEventListener("click", finishQuiz);
  $("#exportButton").addEventListener("click", exportData);
  $("#importInput").addEventListener("change", importData);
  $("#resetButton").addEventListener("click", resetData);
  $("#detailDialog").addEventListener("click", (event) => {
    if (event.target === $("#detailDialog")) $("#detailDialog").close();
  });
}

bindEvents();
renderAll();
