# Deploiement en un conteneur : nginx sert la page depuis l'image et le payload
# depuis un volume monte. Rien n'est compile -- la page est du HTML/CSS/JS nu,
# comme le dashboard maison dont ce depot reprend le moule.
#
# Pas de proxy ici, contrairement a `maison` : cette page ne commande rien. Le
# mac pousse, la page lit. Aucun chemin n'entre.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/ /usr/share/nginx/html/

# Horodatage lisible, affiche en pied de page : deux instances se distinguent
# d'un coup d'oeil.
RUN date -u "+%d/%m/%Y %H:%M UTC" > /usr/share/nginx/html/build.txt

# Cache-busting par l'URL. Sans lui, un redeploiement change les fichiers mais
# pas leurs adresses, et n'importe quel cache entre les deux (navigateur,
# Cloudflare) a le droit de continuer a servir l'ancien corps. L'empreinte est
# un HASH DU CONTENU et pas une date : un asset inchange garde son adresse et
# reste en cache.
RUN set -eu; \
    V=$(cat /usr/share/nginx/html/css/app.css /usr/share/nginx/html/js/app.js \
        | md5sum | cut -c1-10); \
    sed -i "s|css/app\.css|css/app.css?v=$V|; s|js/app\.js|js/app.js?v=$V|" \
        /usr/share/nginx/html/index.html; \
    grep -q "?v=$V" /usr/share/nginx/html/index.html   # la substitution DOIT avoir eu lieu

# Le payload n'est PAS dans l'image : il change toutes les 5 min et arrive par
# ssh depuis le mac (max-dashboard-export.py). Monter le repertoire hote qui le
# recoit sur /data (Coolify > Storages).
RUN mkdir -p /data && echo '{"error":"no data pushed yet"}' > /data/data.json

EXPOSE 80
