(() => {
  const storageKey = "neonlab.theme";
  const root = document.documentElement;

  function updateCommentsTheme(theme) {
    const iframe = document.querySelector("iframe.giscus-frame");
    if (!iframe || !iframe.contentWindow) return;

    const conf = window.__giscus || {};
    const targetTheme =
      theme === "light" ? conf.light || "light" : conf.dark || "dark_dimmed";

    iframe.contentWindow.postMessage(
      {
        giscus: {
          setConfig: {
            theme: targetTheme,
          },
        },
      },
      "https://giscus.app"
    );
  }

  function setTheme(theme, button = null) {
    // 如果有按钮信息，创建从按钮位置向左下角逐步蔓延的动画
    if (button) {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // 计算从按钮位置到左下角的最大距离（确保能覆盖整个屏幕）
      const maxDistance = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      ) * 1.5;

      // 创建半透明遮罩层（圆形扩散）
      const overlay = document.createElement('div');
      overlay.className = 'theme-transition-overlay';
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 99999;
        background: ${theme === 'light' ? '#f5f7ff' : '#0a0e1a'};
        clip-path: circle(0px at ${x}px ${y}px);
        opacity: 0.85;
      `;
      document.body.appendChild(overlay);

      // 添加渐变光晕效果
      const glow = document.createElement('div');
      glow.style.cssText = `
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 99998;
        background: radial-gradient(
          circle at ${x}px ${y}px,
          ${theme === 'light'
            ? 'rgba(6,214,160,0.5), rgba(17,138,178,0.3), transparent 35%'
            : 'rgba(239,71,111,0.5), rgba(17,138,178,0.3), transparent 35%'}
        );
        clip-path: circle(0px at ${x}px ${y}px);
        opacity: 1;
      `;
      document.body.appendChild(glow);

      // 遮罩圆形扩散动画 + 淡出
      const overlayAnimation = overlay.animate([
        { clipPath: `circle(0px at ${x}px ${y}px)`, opacity: 0.85 },
        { clipPath: `circle(${maxDistance}px at ${x}px ${y}px)`, opacity: 0.85, offset: 0.6 },
        { clipPath: `circle(${maxDistance}px at ${x}px ${y}px)`, opacity: 0 }
      ], {
        duration: 700,
        easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
        fill: 'forwards'
      });

      // 光晕扩散动画
      const glowAnimation = glow.animate([
        { clipPath: `circle(0px at ${x}px ${y}px)`, opacity: 1 },
        { clipPath: `circle(${maxDistance * 0.4}px at ${x}px ${y}px)`, opacity: 1, offset: 0.4 },
        { clipPath: `circle(${maxDistance}px at ${x}px ${y}px)`, opacity: 0 }
      ], {
        duration: 700,
        easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
        fill: 'forwards'
      });

      // 在动画中期切换主题
      setTimeout(() => {
        root.dataset.theme = theme;
        try {
          localStorage.setItem(storageKey, theme);
        } catch {}
        updateCommentsTheme(theme);
      }, 280);

      // 动画结束后立即清理
      overlayAnimation.onfinish = () => {
        overlay.remove();
      };

      glowAnimation.onfinish = () => {
        glow.remove();
      };
    } else {
      // 无动画切换（首次加载）
      root.dataset.theme = theme;
      try {
        localStorage.setItem(storageKey, theme);
      } catch {}
      updateCommentsTheme(theme);
    }
  }

  function getPreferredTheme() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  // Init theme early.
  setTheme(getPreferredTheme());
  setTimeout(() => updateCommentsTheme(root.dataset.theme), 900);

  for (const btn of document.querySelectorAll("[data-theme-toggle]")) {
    btn.addEventListener("click", (e) => {
      const next = root.dataset.theme === "light" ? "dark" : "light";
      setTheme(next, e.currentTarget);
    });
  }

  // Mobile nav toggle.
  const hamburger = document.getElementById("hamburger");
  const mobileMenu = document.getElementById("mobileMenu");
  if (hamburger && mobileMenu) {
    const mq = window.matchMedia ? window.matchMedia("(max-width: 768px)") : null;

    const setOpen = (open) => {
      if (open) {
        hamburger.classList.add("active");
        mobileMenu.classList.add("active");
        hamburger.setAttribute("aria-expanded", "true");
      } else {
        hamburger.classList.remove("active");
        mobileMenu.classList.remove("active");
        hamburger.setAttribute("aria-expanded", "false");
      }
    };

    const isOpen = () => hamburger.classList.contains("active");

    // 点击汉堡按钮切换
    hamburger.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(!isOpen());
    });

    // 点击导航链接后关闭
    mobileMenu.addEventListener("click", (e) => {
      const link = e.target.closest("a");
      if (link) setOpen(false);
    });

    // 点击外部关闭
    document.addEventListener("click", (e) => {
      if (!isOpen()) return;
      if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
        setOpen(false);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });

    if (mq) {
      mq.addEventListener("change", (e) => {
        if (!e.matches) setOpen(false);
      });
    }

    setOpen(false);
  }

  // Index search filter
  const navSearch = document.getElementById("navSearch");
  const cards = Array.from(document.querySelectorAll(".post-card"));
  if (!cards.length) return;

  let query = "";

  const normalize = (s) => (s || "").toString().trim().toLowerCase();

  function matches(card) {
    const title = card.getAttribute("data-title") || "";
    const excerpt = card.getAttribute("data-excerpt") || "";
    const tags = normalize(card.getAttribute("data-tags")).split(",").filter(Boolean);

    const q = normalize(query);
    return !q || title.includes(q) || excerpt.includes(q) || tags.some((t) => t.includes(q));
  }

  function render() {
    let visible = 0;
    for (const card of cards) {
      const show = matches(card);
      card.hidden = !show;
      if (show) visible++;
    }
    document.body.dataset.filtered = visible === 0 ? "empty" : "ok";
  }

  if (navSearch) {
    navSearch.addEventListener("input", (e) => {
      query = e.target.value;
      render();
    });
    navSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const grid = document.querySelector(".grid");
        if (grid) {
          grid.scrollIntoView({ behavior: "smooth" });
        }
      }
    });
  }

  // Support deep link filters: /?q=xxx
  const params = new URLSearchParams(window.location.search);
  const q = params.get("q");
  if (typeof q === "string" && q.trim() && navSearch) {
    navSearch.value = q;
    query = q;
  }

  render();
})();

// AI工具卡片动态入场动画 - defer 脚本执行时 DOM 已就绪
const toolCards = document.querySelectorAll('.tool-card');
if (toolCards.length > 0) {
  toolCards.forEach((card, index) => {
    card.style.animationDelay = `${index * 0.05}s`;
  });
}

// ========== 星空粒子背景 ==========
(function initStars() {
  const canvas = document.getElementById('stars-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let stars = [];
  let animationId;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    initStarsArray();
  }

  function initStarsArray() {
    stars = [];
    const count = Math.floor((canvas.width * canvas.height) / 8000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.5 + 0.5,
        speed: Math.random() * 0.3 + 0.1,
        opacity: Math.random() * 0.8 + 0.2,
        twinkle: Math.random() * Math.PI * 2
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const isDark = document.documentElement.dataset.theme !== 'light';

    stars.forEach(star => {
      star.twinkle += 0.02;
      star.y += star.speed;
      if (star.y > canvas.height) {
        star.y = 0;
        star.x = Math.random() * canvas.width;
      }

      const twinkleOpacity = star.opacity * (0.5 + 0.5 * Math.sin(star.twinkle));
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fillStyle = isDark
        ? `rgba(255, 255, 255, ${twinkleOpacity})`
        : `rgba(100, 120, 180, ${twinkleOpacity * 0.6})`;
      ctx.fill();
    });

    animationId = requestAnimationFrame(draw);
  }

  resize();
  draw();
  window.addEventListener('resize', resize);
})();

// ========== 鼠标跟随光晕 ==========
(function initCursorGlow() {
  const glow = document.querySelector('.cursor-glow');
  if (!glow || window.innerWidth < 720) return;

  let mouseX = 0, mouseY = 0;
  let glowX = 0, glowY = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    glow.classList.add('active');
  });

  document.addEventListener('mouseleave', () => {
    glow.classList.remove('active');
  });

  function animate() {
    glowX += (mouseX - glowX) * 0.1;
    glowY += (mouseY - glowY) * 0.1;
    glow.style.left = glowX + 'px';
    glow.style.top = glowY + 'px';
    requestAnimationFrame(animate);
  }
  animate();
})();

// ========== 滚动进度条 ==========
(function initScrollProgress() {
  const progress = document.querySelector('.scroll-progress');
  if (!progress) return;

  function updateProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    progress.style.width = scrollPercent + '%';
  }

  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();
})();

// ========== 返回顶部按钮 ==========
(function initBackToTop() {
  const btn = document.querySelector('.back-to-top');
  if (!btn) return;

  function toggleVisibility() {
    if (window.scrollY > 300) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('scroll', toggleVisibility, { passive: true });
  toggleVisibility();
})();

// ========== 滚动触发入场动画 ==========
(function initScrollReveal() {
  const cards = document.querySelectorAll('.card, .tool-card');
  if (!cards.length) return;

  cards.forEach(card => card.classList.add('scroll-reveal'));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  cards.forEach(card => observer.observe(card));
})();

// ========== 文章目录 TOC ==========
(function initTOC() {
  const tocWrapper = document.getElementById('toc');
  const tocList = document.getElementById('toc-list');
  const articleContent = document.getElementById('article-content');

  if (!tocWrapper || !tocList || !articleContent) return;

  const headings = articleContent.querySelectorAll('h2, h3');
  if (headings.length < 2) return;

  // 生成目录
  headings.forEach((heading, index) => {
    const id = heading.id || `heading-${index}`;
    heading.id = id;

    const li = document.createElement('li');
    li.className = 'toc-item';

    const a = document.createElement('a');
    a.className = `toc-link toc-${heading.tagName.toLowerCase()}`;
    a.href = `#${id}`;
    a.textContent = heading.textContent;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    li.appendChild(a);
    tocList.appendChild(li);
  });

  tocWrapper.classList.add('visible');

  // 高亮当前章节
  const tocLinks = tocList.querySelectorAll('.toc-link');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        tocLinks.forEach(link => link.classList.remove('active'));
        const activeLink = tocList.querySelector(`a[href="#${entry.target.id}"]`);
        if (activeLink) activeLink.classList.add('active');
      }
    });
  }, { threshold: 0, rootMargin: '-80px 0px -70% 0px' });

  headings.forEach(heading => observer.observe(heading));
})();

// ========== 代码块复制按钮 ==========
(function initCodeCopy() {
  const codeBlocks = document.querySelectorAll('.prose pre');
  if (!codeBlocks.length) return;

  codeBlocks.forEach(pre => {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent || pre.textContent;
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = '已复制!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '复制';
          btn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        btn.textContent = '失败';
        setTimeout(() => btn.textContent = '复制', 2000);
      }
    });
    wrapper.appendChild(btn);
  });
})();

// ========== 图片灯箱 ==========
(function initLightbox() {
  const lightbox = document.querySelector('.lightbox');
  const lightboxImg = lightbox?.querySelector('img');
  const lightboxClose = lightbox?.querySelector('.lightbox-close');

  if (!lightbox || !lightboxImg) return;

  const images = document.querySelectorAll('.prose img');

  images.forEach(img => {
    img.addEventListener('click', () => {
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt;
      lightbox.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });

  function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
  }

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lightboxClose) {
      closeLightbox();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('active')) {
      closeLightbox();
    }
  });
})();
