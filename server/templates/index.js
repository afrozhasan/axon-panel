const TEMPLATES = {
  static: {
    id: "static",
    label: "Static HTML",
    description: "Serves files from a document root (HTML, CSS, JS, images).",
    needsPort: false,
    needsSocket: false,
    body: `server {
    listen 80;
    listen [::]:80;
    server_name {{serverNames}};

    root {{root}};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`,
  },
  php: {
    id: "php",
    label: "PHP / Laravel",
    description: "PHP-FPM 8.3 with a public/ document root and front controller.",
    needsPort: false,
    needsSocket: true,
    body: `server {
    listen 80;
    listen [::]:80;
    server_name {{serverNames}};

    root {{root}}/public;
    index index.php index.html index.htm;

    charset utf-8;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        fastcgi_pass unix:{{socket}};
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_hide_header X-Powered-By;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`,
  },
  proxy: {
    id: "proxy",
    label: "Node / app reverse proxy",
    description: "Proxies to a local application port with WebSocket support.",
    needsPort: true,
    needsSocket: false,
    body: `server {
    listen 80;
    listen [::]:80;
    server_name {{serverNames}};

    client_max_body_size {{maxBody}};

    location / {
        proxy_pass http://127.0.0.1:{{port}};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`,
  },
  redirect: {
    id: "redirect",
    label: "Redirect",
    description: "Permanently redirects this host to another URL.",
    needsPort: false,
    needsSocket: false,
    body: `server {
    listen 80;
    listen [::]:80;
    server_name {{serverNames}};

    return 301 {{target}}$request_uri;
}
`,
  },
};

export function listTemplates() {
  return Object.values(TEMPLATES).map(({ body, ...meta }) => meta);
}

export function renderTemplate(id, vars = {}) {
  const template = TEMPLATES[id];
  if (!template) throw new Error(`Unknown template: ${id}`);
  return template.body.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function templateNeeds(id) {
  const template = TEMPLATES[id];
  return {
    port: template?.needsPort ?? false,
    socket: template?.needsSocket ?? false,
  };
}

export function templateExists(id) {
  return Boolean(TEMPLATES[id]);
}
