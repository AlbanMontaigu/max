# CLAUDE.md

Notes pour un agent Claude Code travaillant dans ce dépôt. Lire `README.md`
d'abord : il documente les deux flux, les deux horloges et la raison de la
plupart des choix non évidents. Ne pas re-dériver ce raisonnement, l'étendre.

## Structure

```
Dockerfile              image nginx:alpine, aucune étape de build
nginx.conf              servi tel quel (aucune variable à substituer)
frontend/
  index.html
  css/app.css
  js/app.js             tout le JS de la page, vanilla
```

Aucun backend ici. `max-dashboard-export.py` et `shared/usage_journal.py`
vivent sur le mac (`~/.openclaw/scripts/`, `~/.claude-max-gateway/`) et sont
hors périmètre — ce dépôt ne connaît que la forme du JSON qu'ils produisent.

## Conventions

- **Le texte d'interface est en français** ; code, identifiants et commentaires
  en anglais ou en français selon le fichier. Messages de commit en français.
- **Les messages de commit expliquent le pourquoi**, souvent longuement : c'est
  ici que les décisions non évidentes restent.
- **Aucune étape de build.** Pas de bundler, pas de framework, pas de
  `package.json` sans une vraie raison.
- **Ce dépôt est public.** Jamais de nom de variante, de port, d'hôte ou de
  jeton en dur — tout vient du payload.
- **La page ne détient aucune connaissance du domaine.** Si tu te surprends à
  écrire un libellé de variante dans `app.js`, c'est très probablement un
  changement d'export qu'il faut faire.
- **Thème clair uniquement.** Maintenir deux palettes doublerait chaque
  évolution, et ce qui casse à une bascule de thème ne se voit pas en relisant
  le CSS. Toute la couleur vit dans `app.css`, y compris celle que le JS peint
  dans les SVG.
- **Deux chiffres pour la même chose, c'est un de trop.** Les totaux d'une
  carte se calculent sur la série qui la dessine, jamais sur un second champ du
  payload qui pourrait diverger.

## Avant d'éditer

1. Vérifier si le changement implique une modification côté export
   (`~/.openclaw/scripts/max-dashboard-export.py`) : ce dépôt se déploie
   indépendamment, un champ attendu ici doit déjà exister là-bas.
2. `git status` doit être propre ; il n'y a pas de branche de recette, les
   commits partent sur `main` et la production se déclenche à la main.
3. Rendre la page dans un navigateur avant de conclure qu'elle va bien.
