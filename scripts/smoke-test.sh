#!/usr/bin/env bash
# Testa as rotas públicas do agregado de catálogo contra o servidor em $BASE.
set -u
BASE="${1:-http://localhost:3000}"

echo "== health =="
curl -sf "$BASE/health" >/dev/null && echo "ok" || echo "FALHOU"

echo "== paginação completa =="
: > /tmp/smoke-ids.txt
: > /tmp/smoke-cards.jsonl
page=1
while :; do
  json=$(curl -s "$BASE/api/catalog?page=$page&limit=24")
  echo "$json" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s);
      if (j.error) { console.error("ERRO:", j.error); process.exit(1); }
      const fs=require("fs");
      j.dramas.forEach(d=>{console.log(d._id);fs.appendFileSync("/tmp/smoke-cards.jsonl",JSON.stringify(d)+"\n")});
      console.error(`  página ${j.pagination.pagina}/${j.pagination.totalPaginas}: ${j.dramas.length} itens | total ${j.pagination.total} | mais ${j.pagination.mais}`);
      process.exit(j.pagination.mais ? 0 : 42);
    });' >> /tmp/smoke-ids.txt
  code=$?
  [ $code -eq 0 ] && { page=$((page+1)); [ $page -le 40 ] && continue; }
  break
done

total=$(wc -l < /tmp/smoke-ids.txt)
unique=$(sort /tmp/smoke-ids.txt | uniq | wc -l)
echo "itens coletados: $total | ids únicos: $unique | duplicados: $((total - unique))"
[ "$total" -eq "$unique" ] || echo "PROBLEMA: itens repetidos entre páginas"

echo "== capas no acervo completo e faixa 96–146 =="
node - <<'NODE'
const fs = require('fs');
const items = fs.readFileSync('/tmp/smoke-cards.jsonl', 'utf8').trim().split(/\n/).filter(Boolean).map(line => JSON.parse(line));
const cover = item => item.capaVertical || item.capaPrincipal || item.thumbnail || '';
const range = items.slice(95, 146);
const urls = range.map(cover).filter(Boolean);
console.log(`  títulos=${items.length} | sem capa=${items.filter(item => !cover(item)).length}`);
console.log(`  posições 96–146: ${range.length} cards | ${new Set(urls).size} URLs distintas | sem capa=${range.filter(item => !cover(item)).length}`);
console.log(`  auth_key vazando: ${items.some(item => /auth_key/.test(cover(item)))}`);
NODE

echo "== campos obrigatórios do card =="
curl -s "$BASE/api/catalog?page=1&limit=24" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j=JSON.parse(s);
    const missing = j.dramas.filter(d => !d._id || !d.titulo || !d.capaPrincipal || !d.sinopse || d.dublado !== true);
    console.log(`sem id/título/capa/sinopse ou não dublado: ${missing.length}/${j.dramas.length}`);
    console.log("assinatura auth_key vazando na capa:", j.dramas.some(d => /auth_key/.test(d.capaPrincipal||"")));
    console.log("exemplo:", JSON.stringify(j.dramas[0]).slice(0, 220));
  });'

echo "== ordenações =="
for sort in recentes vistos episodios; do
  curl -s "$BASE/api/catalog?page=1&limit=6&sort=$sort" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const j=JSON.parse(s);
      console.log('  $sort:', (j.dramas||[]).slice(0,3).map(d=>d.titulo.slice(0,26)).join(' | '));
    });"
done

echo "== filtros por tag =="
curl -s "$BASE/api/catalog/meta" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const m=JSON.parse(s);
    console.log(`  total=${m.total} semente=${m.semente} aoVivo=${m.aoVivo} tags=${m.tags.length} avisos=${JSON.stringify(m.avisos)}`);
    (m.tags||[]).slice(0,3).forEach(t=>console.log(`  ${t.slug} (${t.nome})`));
  });'
for slug in $(curl -s "$BASE/api/catalog/meta" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tags.slice(0,2).map(t=>t.slug).join(" ")))'); do
  curl -s "$BASE/api/catalog?page=1&limit=60&tag=$slug" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const j=JSON.parse(s);
      console.log('  tag $slug ->', j.pagination.total, 'títulos');
    });"
done

echo "== busca =="
for term in "esposa" "lobisomem" "pulseira"; do
  curl -s "$BASE/api/catalog" --get --data-urlencode "q=$term" --data-urlencode "limit=24" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const j=JSON.parse(s);
      const ids=(j.dramas||[]).map(d=>d._id);
      console.log('  \"$term\" ->', j.pagination.total, 'resultados | origem', j.busca?.origem, '| duplicados', ids.length-new Set(ids).size);
      (j.dramas||[]).slice(0,3).forEach(d=>console.log('     ', d._id, d.titulo.slice(0,44)));
    });"
done

echo "== detalhe de um título achado só na busca =="
id=$(curl -s "$BASE/api/catalog" --get --data-urlencode "q=herdeira" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.dramas?.[0]?._id??"")})')
if [ -n "$id" ]; then
  echo "  id $id |"
  curl -s "$BASE/api/catalog/detail/$id" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s);
      const eps=j.episodes||[];
      console.log(j.drama?.titulo, "| episódios", eps.length, "| com HLS", eps.filter(e=>e.video?.video_720).length, "| erro", j.error||"-");
    });'
else
  echo "  (nenhum resultado para o termo de teste)"
fi
