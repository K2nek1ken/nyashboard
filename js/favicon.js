// Иконка вкладки подстраивается под выбранный акцент: розовая иконка при
// оранжевой теме выглядела бы так же чужеродно, как розовый аноним в ленте.
// Файл assets/favicon.svg остаётся статичным запасным вариантом — он нужен
// для манифеста и для случая, если JS не отработал.

const SHAPE = (accent, dark) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080">
<defs><clipPath id="r"><circle cx="540" cy="540" r="540"/></clipPath></defs>
<g clip-path="url(#r)">
<rect width="1080" height="1080" fill="${accent}"/>
<polygon transform="matrix(0.9035287,0.4285275,-0.4285275,0.9035287,615.3612,-263.7764)" points="284.41,796.69 540,353.99 795.59,796.69" fill="#fff"/>
<polygon transform="matrix(-0.947595,0.3194743,0.3194743,0.9475950,554.9836,-248.3596)" points="284.41,796.69 540,353.99 795.59,796.69" fill="#fff"/>
<ellipse transform="matrix(0.9982692,0.0588099,-0.0588099,0.9982692,540,940.1891)" rx="520.57" ry="520.57" fill="#fff"/>
<ellipse transform="matrix(0.9982692,0.0588099,-0.0588099,0.9982692,310.7745,649.7848)" rx="86.44" ry="86.44" fill="${dark}"/>
<ellipse transform="matrix(0.9982692,0.0588099,-0.0588099,0.9982692,715.7533,673.6428)" rx="86.44" ry="86.44" fill="${dark}"/>
</g></svg>`;

// Та же мордочка, что и на вкладке браузера, но для шапки сайта.
// Возвращает data-URI, поэтому подставляется в обычный <img> и перекрашивается
// вместе с темой.
export function brandIconUri() {
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue("--accent").trim() || "#ff6eae";
  const dark = cs.getPropertyValue("--bg").trim() || "#17131c";
  return "data:image/svg+xml," + encodeURIComponent(SHAPE(accent, dark).replace(/\s+/g, " "));
}

export function applyFavicon() {
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue("--accent").trim() || "#ff6eae";
  const dark = cs.getPropertyValue("--bg").trim() || "#17131c";

  const uri = "data:image/svg+xml," + encodeURIComponent(SHAPE(accent, dark).replace(/\s+/g, " "));
  // Заменяем все объявленные иконки: если оставить старую ссылку на файл,
  // браузер может продолжить показывать закэшированную версию.
  const links = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
  if (!links.length) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = uri;
    document.head.appendChild(link);
  } else {
    links.forEach(l => { l.type = "image/svg+xml"; l.href = uri; });
  }

  // цвет строки состояния на телефоне — под фон темы
  let theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.content = cs.getPropertyValue("--bg").trim() || "#17131c";

  // иконка в шапке — та же мордочка, её тоже перекрашиваем
  document.querySelectorAll("[data-brand-icon]").forEach(img => { img.src = uri; });
}
