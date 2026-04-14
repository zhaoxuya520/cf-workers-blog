(() => {
  const form = document.getElementById("loginForm");
  const usernameInput = document.getElementById("loginUsername");
  const passwordInput = document.getElementById("loginPassword");
  const status = document.getElementById("loginStatus");
  const card = document.querySelector(".admin-login-card");

  function setStatus(message, kind = "info") {
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  async function requestSession() {
    const response = await fetch("/api/admin/session", { credentials: "same-origin" });
    if (!response.ok) return null;
    return response.json();
  }

  async function login(event) {
    event.preventDefault();
    const username = String(usernameInput?.value || "").trim();
    const password = String(passwordInput?.value || "");

    if (!username || !password) {
      setStatus("请输入用户名和密码。", "error");
      return;
    }

    setStatus("正在验证身份...", "info");

    const response = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(data.error || `登录失败（${response.status}）`, "error");
      return;
    }

    setStatus("登录成功，正在进入后台...", "success");
    window.location.href = "/admin";
  }

  function bindTilt() {
    if (!card) return;
    card.addEventListener("mousemove", (event) => {
      const rect = card.getBoundingClientRect();
      const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
      const offsetY = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(1200px) rotateX(${(-offsetY * 4).toFixed(2)}deg) rotateY(${(offsetX * 6).toFixed(2)}deg) translateY(-2px)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  }

  async function bootstrap() {
    try {
      const session = await requestSession();
      if (session?.authenticated) {
        window.location.href = "/admin";
        return;
      }
    } catch {}
  }

  form?.addEventListener("submit", (event) => {
    login(event).catch((error) => {
      setStatus(error.message || "登录失败。", "error");
    });
  });

  bindTilt();
  bootstrap();
})();
