const authStatus = document.getElementById("authStatus");
const authMessage = document.getElementById("authMessage");
const logoutBtn = document.getElementById("logoutBtn");
const intakeSection = document.getElementById("intakeSection");
const adminSection = document.getElementById("adminSection");
const servicesSection = document.getElementById("servicesSection");
const billingSection = document.getElementById("billingSection");
const refreshAdminBtn = document.getElementById("refreshAdminBtn");
const refreshProvidersBtn = document.getElementById("refreshProvidersBtn");

const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const verifyRequestForm = document.getElementById("verifyRequestForm");
const verifyConfirmForm = document.getElementById("verifyConfirmForm");
const resetRequestForm = document.getElementById("resetRequestForm");
const resetConfirmForm = document.getElementById("resetConfirmForm");
const providerForm = document.getElementById("providerForm");

const intakeForm = document.getElementById("intakeForm");
const successMessage = document.getElementById("successMessage");
const dashboard = document.getElementById("dashboard");
const loadLatestBtn = document.getElementById("loadLatestBtn");

const fields = ["ownerType", "businessName", "businessType", "targetAudience", "struggles", "supportNeeded"];

const TOKEN_KEY = "nexyra_auth_token";
const USER_KEY = "nexyra_auth_user";
const API_BASE_URL = String(window.NEXYRA_API_BASE_URL || "").replace(/\/+$/, "");

const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const getUser = () => {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
};

const setSession = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

const api = async (url, options = {}) => {
  const endpoint = /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let resp;
  try {
    resp = await fetch(endpoint, { ...options, headers });
  } catch {
    throw new Error(`Cannot reach backend at ${API_BASE_URL || "same-origin (/api)"}`);
  }

  const text = await resp.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!resp.ok) {
    const detail = data.error || data.message || text || `${resp.status} ${resp.statusText}`;
    throw new Error(String(detail).slice(0, 180));
  }
  return data;
};

const setMessage = (value) => {
  authMessage.textContent = value;
};

const renderAuthState = () => {
  const user = getUser();
  const loggedIn = !!getToken() && !!user;

  intakeSection.classList.toggle("hidden", !loggedIn);
  servicesSection.classList.toggle("hidden", !loggedIn);
  billingSection.classList.toggle("hidden", !loggedIn);
  logoutBtn.classList.toggle("hidden", !loggedIn);

  if (!loggedIn) {
    authStatus.textContent = "Sign in or create an account to continue.";
    adminSection.classList.add("hidden");
    dashboard.classList.add("hidden");
    return;
  }

  authStatus.textContent = `Logged in as ${user.name} (${user.email}) ${user.emailVerified ? "- email verified" : "- email not verified"}`;
  adminSection.classList.toggle("hidden", !user.isAdmin);
};

const getErrorElement = (fieldName) => document.getElementById(`${fieldName}Error`);

const validateField = (fieldName) => {
  const input = document.getElementById(fieldName);
  const errorEl = getErrorElement(fieldName);
  const value = input.value.trim();

  if (!value) {
    errorEl.textContent = "This field is required.";
    return false;
  }

  errorEl.textContent = "";
  return true;
};

const validateForm = () => {
  let valid = true;
  fields.forEach((fieldName) => {
    if (!validateField(fieldName)) valid = false;
  });
  return valid;
};

const renderList = (elementId, items) => {
  const el = document.getElementById(elementId);
  el.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
};

const renderDashboard = (submission) => {
  document.getElementById("dashboardTitle").textContent = `${submission.businessName} Growth Plan`;
  document.getElementById("dashboardSummary").textContent = `${submission.businessName} is focused on ${submission.businessType}. This plan aligns your coaching support and service needs to your top priorities.`;
  document.getElementById("dashboardStage").textContent = submission.ownerType === "existing" ? "Existing Business Owner" : "Future Business Owner";
  document.getElementById("dashboardAudience").textContent = submission.targetAudience;
  document.getElementById("dashboardFocus").textContent = submission.focusTitle;

  renderList("struggleList", [submission.struggles, submission.supportNeeded]);
  renderList("serviceList", submission.serviceMatches || []);
  renderList("actionPlanList", submission.actionPlan || []);
  document.getElementById("aiCoachingText").textContent = submission.aiCoaching || "No AI coaching returned.";

  dashboard.classList.remove("hidden");
};

const loadLatest = async () => {
  try {
    const latest = await api("/api/intake/latest", { method: "GET" });
    renderDashboard(latest);
    successMessage.classList.add("hidden");
  } catch (error) {
    successMessage.classList.remove("hidden");
    successMessage.querySelector("h2").textContent = "No intake found yet.";
    successMessage.querySelector("p").textContent = error.message;
  }
};

const renderProviderCard = (provider) => {
  const card = document.createElement("article");
  card.className = "panel provider-card";

  const title = document.createElement("h3");
  title.textContent = provider.name;
  card.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "muted";
  desc.textContent = provider.description;
  card.appendChild(desc);

  const meta = document.createElement("p");
  meta.className = "provider-meta";
  meta.textContent = `${provider.service_type} | ${provider.audience_type} | from $${provider.price_start}`;
  card.appendChild(meta);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = "Request Intro";
  button.dataset.providerId = String(provider.id);
  button.addEventListener("click", async () => {
    try {
      await api(`/api/providers/${provider.id}/request`, {
        method: "POST",
        body: JSON.stringify({ note: `Interested in ${provider.service_type} support.` }),
      });
      setMessage(`Request sent to ${provider.name}.`);
      if (getUser()?.isAdmin) await loadAdminRequests();
    } catch (error) {
      setMessage(error.message);
    }
  });

  card.appendChild(button);
  return card;
};

const loadProviders = async () => {
  try {
    const list = await api("/api/providers/matches", { method: "GET" });
    const host = document.getElementById("providersList");
    host.innerHTML = "";

    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No provider matches found yet.";
      host.appendChild(empty);
      return;
    }

    list.forEach((provider) => host.appendChild(renderProviderCard(provider)));
  } catch (error) {
    setMessage(`Provider load failed: ${error.message}`);
  }
};

const loadBillingPlans = async () => {
  try {
    const plans = await api("/api/billing/plans", { method: "GET" });
    const host = document.getElementById("billingPlans");
    host.innerHTML = "";

    plans.forEach((plan) => {
      const panel = document.createElement("article");
      panel.className = "panel";

      const h3 = document.createElement("h3");
      h3.textContent = plan.label;
      panel.appendChild(h3);

      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = plan.available ? "Ready to checkout" : "Not configured yet";
      panel.appendChild(p);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.disabled = !plan.available;
      button.textContent = "Start Plan";
      button.addEventListener("click", async () => {
        try {
          const data = await api("/api/billing/create-checkout-session", {
            method: "POST",
            body: JSON.stringify({ planId: plan.id }),
          });
          window.location.href = data.url;
        } catch (error) {
          setMessage(error.message);
        }
      });
      panel.appendChild(button);
      host.appendChild(panel);
    });
  } catch (error) {
    setMessage(`Billing load failed: ${error.message}`);
  }
};

const fillTable = (tbodyId, rows, columns) => {
  const body = document.getElementById(tbodyId);
  body.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      td.textContent = row[column] == null ? "" : String(row[column]);
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
};

const loadAdminSubmissions = async () => {
  if (!getUser()?.isAdmin) return;
  try {
    const rows = await api("/api/admin/submissions", { method: "GET" });
    fillTable("adminRows", rows, ["id", "name", "email", "business_name", "focus_title", "created_at"]);
  } catch (error) {
    setMessage(`Admin submissions load failed: ${error.message}`);
  }
};

const loadAdminRequests = async () => {
  if (!getUser()?.isAdmin) return;
  try {
    const rows = await api("/api/admin/requests", { method: "GET" });
    fillTable("adminRequestRows", rows, ["id", "name", "email", "provider_name", "status", "note"]);
  } catch (error) {
    setMessage(`Admin requests load failed: ${error.message}`);
  }
};

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  try {
    const payload = {
      name: registerForm.registerName.value.trim(),
      email: registerForm.registerEmail.value.trim(),
      password: registerForm.registerPassword.value,
    };
    const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
    setSession(data.token, data.user);
    registerForm.reset();
    renderAuthState();
    await Promise.all([loadLatest(), loadProviders(), loadBillingPlans()]);

    const tokenHint = data.verification?.tokenPreview ? ` Verify token: ${data.verification.tokenPreview}` : "";
    setMessage(`Account created. Verification requested.${tokenHint}`);
  } catch (error) {
    setMessage(error.message);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  try {
    const payload = { email: loginForm.loginEmail.value.trim(), password: loginForm.loginPassword.value };
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
    setSession(data.token, data.user);
    loginForm.reset();
    renderAuthState();
    await Promise.all([loadLatest(), loadProviders(), loadBillingPlans()]);
    if (data.user.isAdmin) {
      await Promise.all([loadAdminSubmissions(), loadAdminRequests()]);
    }
  } catch (error) {
    setMessage(error.message);
  }
});

verifyRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  try {
    const email = document.getElementById("verifyEmail").value.trim();
    const data = await api("/api/auth/request-verification", { method: "POST", body: JSON.stringify({ email }) });
    const tokenHint = data.tokenPreview ? ` Token: ${data.tokenPreview}` : "";
    setMessage(`Verification token sent.${tokenHint}`);
  } catch (error) {
    setMessage(error.message);
  }
});

verifyConfirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  try {
    const tokenValue = document.getElementById("verifyToken").value.trim();
    const data = await api("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token: tokenValue }) });
    if (getToken()) {
      setSession(data.token, data.user);
      renderAuthState();
    }
    setMessage("Email verified successfully.");
  } catch (error) {
    setMessage(error.message);
  }
});

resetRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  try {
    const email = document.getElementById("resetEmail").value.trim();
    const data = await api("/api/auth/request-password-reset", { method: "POST", body: JSON.stringify({ email }) });
    const tokenHint = data.tokenPreview ? ` Token: ${data.tokenPreview}` : "";
    setMessage(`Password reset token sent.${tokenHint}`);
  } catch (error) {
    setMessage(error.message);
  }
});

resetConfirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  try {
    const token = document.getElementById("resetToken").value.trim();
    const newPassword = document.getElementById("resetNewPassword").value;
    await api("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) });
    resetConfirmForm.reset();
    setMessage("Password updated. You can now log in with your new password.");
  } catch (error) {
    setMessage(error.message);
  }
});

fields.forEach((fieldName) => {
  document.getElementById(fieldName).addEventListener("blur", () => validateField(fieldName));
});

intakeForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!validateForm()) {
    successMessage.classList.add("hidden");
    return;
  }

  const payload = {
    ownerType: intakeForm.ownerType.value.trim(),
    businessName: intakeForm.businessName.value.trim(),
    businessType: intakeForm.businessType.value.trim(),
    targetAudience: intakeForm.targetAudience.value.trim(),
    struggles: intakeForm.struggles.value.trim(),
    supportNeeded: intakeForm.supportNeeded.value.trim(),
  };

  try {
    const data = await api("/api/intake", { method: "POST", body: JSON.stringify(payload) });
    renderDashboard(data.submission);
    intakeForm.reset();
    successMessage.querySelector("h2").textContent = "Intake submitted.";
    successMessage.querySelector("p").textContent = "Your dashboard has been updated with your latest plan.";
    successMessage.classList.remove("hidden");

    await loadProviders();
    if (getUser()?.isAdmin) await loadAdminSubmissions();
  } catch (error) {
    successMessage.querySelector("h2").textContent = "Submission failed.";
    successMessage.querySelector("p").textContent = error.message;
    successMessage.classList.remove("hidden");
  }
});

providerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  try {
    const payload = {
      name: document.getElementById("providerName").value.trim(),
      serviceType: document.getElementById("providerServiceType").value.trim(),
      audienceType: document.getElementById("providerAudienceType").value.trim(),
      industries: document.getElementById("providerIndustries").value.trim(),
      description: document.getElementById("providerDescription").value.trim(),
      priceStart: Number(document.getElementById("providerPriceStart").value),
    };

    await api("/api/admin/providers", { method: "POST", body: JSON.stringify(payload) });
    providerForm.reset();
    setMessage("Provider added.");
    await loadProviders();
  } catch (error) {
    setMessage(error.message);
  }
});

loadLatestBtn.addEventListener("click", loadLatest);
refreshProvidersBtn.addEventListener("click", loadProviders);
refreshAdminBtn.addEventListener("click", async () => {
  await Promise.all([loadAdminSubmissions(), loadAdminRequests()]);
});

logoutBtn.addEventListener("click", () => {
  clearSession();
  setMessage("");
  dashboard.classList.add("hidden");
  successMessage.classList.add("hidden");
  renderAuthState();
});

(async () => {
  try {
    await api("/api/health", { method: "GET", headers: {} });
  } catch (error) {
    setMessage(error.message);
  }

  renderAuthState();
  if (!getToken()) return;

  try {
    const user = await api("/api/me", { method: "GET" });
    setSession(getToken(), user);
    renderAuthState();
    await Promise.all([loadLatest(), loadProviders(), loadBillingPlans()]);
    if (user.isAdmin) {
      await Promise.all([loadAdminSubmissions(), loadAdminRequests()]);
    }
  } catch {
    clearSession();
    renderAuthState();
  }
})();
