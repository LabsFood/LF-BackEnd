# Lancer tout LabsFood en local (les 4 repos)

Ce guide permet a n'importe quel nouveau developpeur de recuperer et lancer
l'ensemble de la stack LabsFood sur sa machine, sans configuration manuelle
au cas par cas. Tout tourne dans Docker : plus de "ca marche pas chez moi"
lie a une version de Node/npm differente entre les repos.

Temps estime : 10-15 minutes (premier lancement, le temps de builder les
images), puis quelques secondes les fois suivantes.

## 1. Prerequis (une seule fois sur la machine)

- [Git](https://git-scm.com/downloads)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — doit
  etre **lance** avant l'etape 4
- Un compte GitHub ajoute comme collaborateur sur l'organisation `LabsFood`
  (a demander a l'equipe)

## 2. Cloner les 4 repos cote a cote

Les 4 dossiers doivent se trouver **directement sous le meme dossier
parent** — le `docker-compose.yml` de l'etape 3 y fait reference par chemin
relatif.

```bash
mkdir LabsFood && cd LabsFood
git clone https://github.com/LabsFood/LF-BackEnd.git
git clone https://github.com/LabsFood/batchcooking-web.git
git clone https://github.com/LabsFood/labsfood-web.git
git clone https://github.com/LabsFood/admin-dashboard.git
```

Verifiez que chaque repo est bien sur `develop` (branche par defaut normalement) :

```bash
for d in LF-BackEnd batchcooking-web labsfood-web admin-dashboard; do
  (cd "$d" && git checkout develop && git pull)
done
```

## 3. Copier les fichiers d'orchestration a la racine

Ces deux fichiers vivent dans `LF-BackEnd/local-dev/` (ils ne peuvent pas
etre a la racine de `LabsFood/` puisqu'il n'y a pas de repo Git a ce
niveau-la). Copiez-les au meme niveau que les 4 dossiers clones :

```bash
# depuis le dossier LabsFood/ (celui qui contient les 4 repos)
cp LF-BackEnd/local-dev/docker-compose.yml .
cp LF-BackEnd/local-dev/.env.example .env
```

Ouvrez `.env` et remplissez les cles dont vous avez besoin. **Pour un
premier lancement, les valeurs par defaut suffisent** — le backend tourne en
mode stub sans les cles tierces (voir `LF-BackEnd/AGENTS.md`).

## 4. Lancer toute la stack

```bash
docker compose up -d --build
```

Le tout premier lancement telecharge les images et fait `npm install` dans
chaque conteneur : comptez plusieurs minutes. Les lancements suivants
reutilisent le cache Docker et sont rapides.

## 5. Verifier que tout tourne

| Service | URL |
|---|---|
| API backend — Swagger | http://localhost:8000/docs |
| API backend — health check | http://localhost:8000/health |
| batchcooking-web (site client) | http://localhost:3005 |
| labsfood-web (site vitrine) | http://localhost:3007 |
| admin-dashboard (back-office) | http://localhost:8035 |

Commandes utiles :

```bash
docker compose ps          # etat des 5 conteneurs
docker compose logs -f      # logs en direct, tous services
docker compose logs -f api  # logs d'un seul service
docker compose down         # tout arreter
docker compose up -d --build  # relancer apres avoir pull les 4 repos
```

## 6. Depannage

**`port is already allocated` sur Postgres**
Un autre projet sur votre machine utilise deja ce port. Dans le
`docker-compose.yml` copie a l'etape 3, changez uniquement le cote gauche du
port Postgres, ex. `"55433:5432"` au lieu de `"55432:5432"`.

**`npm ci` echoue avec `EUSAGE` / "lock file" desynchronise**
Ne devrait plus arriver sur `develop` (corrige). Si ca se reproduit apres
avoir modifie un `package.json` vous-meme : relancez `npm install` en local
dans le dossier concerne pour regenerer `package-lock.json` avant de commit.

**Erreur `buildkit-mount... Dockerfile: no such file or directory`**
Verifiez que vous etes bien sur la branche `develop` dans les 4 dossiers
(pas une branche plus ancienne qui n'a pas encore de `Dockerfile`).

**Windows**
Lancez ces commandes dans **Git Bash**, pas PowerShell ni l'invite de
commandes — plusieurs scripts du projet supposent un shell Unix.

## Alternative sans Docker

Chaque repo a son propre `AGENTS.md` avec les instructions `npm install` /
`npm run dev` natives. C'est possible mais **non recommande** : c'est
justement l'absence de containerisation qui causait des problemes de
versions Node/npm differentes d'un repo a l'autre avant la mise en place de
ce guide.

## Ce guide vous manque quelque chose ?

Ouvrez une issue ou une PR sur ce repo (`LF-BackEnd`) pour completer ce
fichier — il est fait pour eviter d'avoir a solliciter l'equipe a chaque
nouvel arrivant.
