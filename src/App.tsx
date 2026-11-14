import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { endStream, ensureVisitor, getDrama, heartbeat, listCategories, listDramas, listSeedDramas, resetVisitor, startStream } from './api';
import type { Category, Drama, Episode, Season } from './types';

const FALLBACK_COVER = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=80';

type Screen = 'catalog' | 'detail';
type PlayerState = { season: number; episode: number } | null;

type FlatEpisode = Episode & { seasonNumber: number; seasonTitle: string };

function coverFor(drama: Drama) {
  return drama.capaVertical || drama.capaPrincipal || drama.thumbnail || FALLBACK_COVER;
}

function flattenEpisodes(drama: Drama | null): FlatEpisode[] {
  if (!drama?.temporadas) return [];
  return drama.temporadas.flatMap((season) => season.episodios.map((episode) => ({
    ...episode,
    seasonNumber: season.numero,
    seasonTitle: season.titulo,
  })));
}

function formatDuration(seconds?: number) {
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min`;
}

function categorySlug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function belongsToCategory(drama: Drama, slug: string) {
  const labels = [...(drama.generos || []), ...(drama.tags || [])];
  return labels.some((label) => categorySlug(label) === slug);
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('catalog');
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [selectedDrama, setSelectedDrama] = useState<Drama | null>(null);
  const [player, setPlayer] = useState<PlayerState>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [visitorReady, setVisitorReady] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const bootStartedRef = useRef(false);
  const searchEffectReadyRef = useRef(false);
  const categoryEffectReadyRef = useRef(false);
  const catalogRequestRef = useRef(0);

  const loadCatalog = useCallback(async (nextPage: number, replace = false, query = '', category = '') => {
    const requestId = ++catalogRequestRef.current;
    setCatalogError('');
    setLoading(true);
    try {
      let result: Awaited<ReturnType<typeof listDramas>>;
      try {
        result = await listDramas(nextPage, 30, query, '', '', category === '__free__');
      } catch (firstError) {
        if (nextPage !== 1) throw firstError;
        resetVisitor(true);
        await ensureVisitor();
        try {
          result = await listDramas(nextPage, 30, query, '', '', category === '__free__');
        } catch {
          // Alguns estados antigos do backend rejeitam o filtro `tipo`; tente a rota base.
          try {
            result = await listDramas(nextPage, 30, query, '', '', category === '__free__');
          } catch {
            // O cache é apenas um plano de continuidade para o protótipo temporário.
            if (query) throw new Error('Não foi possível pesquisar agora. Tente novamente.');
            result = await listSeedDramas();
          }
        }
      }
      if (requestId !== catalogRequestRef.current) return;
      const visibleDramas = category && category !== '__free__'
        ? result.dramas.filter((drama) => belongsToCategory(drama, category))
        : result.dramas;
      setDramas((current) => {
        if (replace) return visibleDramas;
        const existing = new Set(current.map((drama) => drama._id));
        return [...current, ...visibleDramas.filter((drama) => !existing.has(drama._id))];
      });
      setPage(nextPage);
      const totalPages = result.pagination?.totalPaginas;
      setHasMore(totalPages ? nextPage < totalPages : result.dramas.length >= 30);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Erro ao carregar o catálogo.');
    } finally {
      if (requestId === catalogRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    (async () => {
      try {
        await ensureVisitor();
        setVisitorReady(true);
        const catalogPromise = loadCatalog(1, true, '', '');
        try {
          setCategories(await listCategories());
        } catch {
          setCategories([]);
        }
        await catalogPromise;
      } catch (error) {
        try {
          const seed = await listSeedDramas();
          setDramas(seed.dramas);
          setPage(1);
          setHasMore(false);
          setCatalogError('');
        } catch {
          setCatalogError(error instanceof Error ? error.message : 'Não foi possível iniciar a sessão.');
        }
        setLoading(false);
      }
    })();
  }, [loadCatalog]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!searchEffectReadyRef.current) {
      searchEffectReadyRef.current = true;
      return;
    }
    void loadCatalog(1, true, searchQuery, activeCategory);
  }, [loadCatalog, searchQuery]);

  useEffect(() => {
    if (!categoryEffectReadyRef.current) {
      categoryEffectReadyRef.current = true;
      return;
    }
    void loadCatalog(1, true, searchQuery, activeCategory);
  }, [activeCategory, loadCatalog, searchQuery]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !visitorReady || !hasMore) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loading) loadCatalog(page + 1, false, searchQuery);
    }, { rootMargin: '600px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadCatalog, loading, page, searchQuery, visitorReady]);

  const openDrama = async (drama: Drama) => {
    window.history.pushState({}, '', `/drama/${drama._id}`);
    setScreen('detail');
    setDetailError('');
    setDetailLoading(true);
    setSelectedDrama(drama);
    try {
      const freshDrama = await getDrama(drama._id);
      setSelectedDrama(freshDrama);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Não foi possível abrir o dorama.');
    } finally {
      setDetailLoading(false);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeDetail = () => {
    window.history.pushState({}, '', '/');
    setScreen('catalog');
    setSelectedDrama(null);
    setDetailError('');
  };

  const selectCategory = (category: string) => {
    setActiveCategory(category);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredDramas = useMemo(() => {
    if (activeCategory === '__free__') return dramas.filter((drama) => drama.gratis === true);
    if (!activeCategory) return dramas;
    return dramas.filter((drama) => belongsToCategory(drama, activeCategory));
  }, [activeCategory, dramas]);

  const openEpisode = (episode: FlatEpisode) => {
    setPlayer({ season: episode.seasonNumber, episode: episode.numero });
  };

  const routeDramaId = window.location.pathname.startsWith('/drama/') ? window.location.pathname.split('/')[2] : null;
  useEffect(() => {
    if (routeDramaId && dramas.length && screen === 'catalog') {
      const match = dramas.find((drama) => drama._id === routeDramaId);
      if (match) void openDrama(match);
    }
    // The initial route is read once after the first catalog page is available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dramas.length, routeDramaId]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={closeDetail} aria-label="Voltar ao catálogo">
          <span className="brand-mark">▮</span>
          <span>Drama <b>Reels</b></span>
        </button>
        <div className="topbar-meta"><span className="live-dot" /> laboratório de streaming</div>
      </header>

      {screen === 'catalog' ? (
        <main className="catalog-page">
          <section className="catalog-hero">
            <div>
              <p className="eyebrow">DESCUBRA A PRÓXIMA HISTÓRIA</p>
              <h1>Escolha uma história<span>.</span></h1>
              <p className="hero-copy">Mini séries para explorar agora. Abra uma história e deslize pelos episódios como um Reels.</p>
            </div>
            <div className="hero-stat"><strong>{filteredDramas.length || '—'}</strong><span>títulos carregados</span></div>
          </section>

          <div className="catalog-search" role="search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Pesquisar dorama por título" aria-label="Pesquisar dorama por título" />
            {searchInput && <button type="button" className="clear-search" onClick={() => setSearchInput('')} aria-label="Limpar pesquisa">×</button>}
          </div>

          <nav className="category-tabs" aria-label="Categorias de doramas">
            <button className={activeCategory === '' ? 'category-tab active' : 'category-tab'} type="button" onClick={() => selectCategory('')} aria-selected={activeCategory === ''}>Todos</button>
            <button className={activeCategory === '__free__' ? 'category-tab active' : 'category-tab'} type="button" onClick={() => selectCategory('__free__')} aria-selected={activeCategory === '__free__'}>Grátis</button>
            {categories.map((category) => <button className={activeCategory === category.slug ? 'category-tab active' : 'category-tab'} type="button" key={`${category.slug}-${category.nome}`} onClick={() => selectCategory(category.slug)} aria-selected={activeCategory === category.slug}>{category.nome}</button>)}
          </nav>

          {catalogError && <ErrorPanel message={catalogError} onRetry={() => void loadCatalog(1, true, searchQuery, activeCategory)} />}
          {loading && filteredDramas.length === 0 ? <CatalogSkeleton /> : (
            filteredDramas.length > 0 ? <section className="catalog-list" aria-label="Lista de doramas">
              {filteredDramas.map((drama, index) => <DramaCard key={`${drama._id}-${index}`} drama={drama} index={index} onOpen={openDrama} />)}
            </section> : <div className="no-results">Nenhum dorama encontrado para esta categoria.</div>
          )}
          <div ref={sentinelRef} className="catalog-sentinel">
            {hasMore ? <>
              <span>{loading ? 'carregando mais histórias…' : 'deslize para carregar mais histórias'}</span>
              {!loading && <button className="load-more-button" type="button" onClick={() => void loadCatalog(page + 1, false, searchQuery, activeCategory)}>carregar mais</button>}
            </> : 'fim da seleção'}
          </div>
        </main>
      ) : (
        <DetailView
          drama={selectedDrama}
          loading={detailLoading}
          error={detailError}
          onBack={closeDetail}
          onOpenEpisode={openEpisode}
        />
      )}

      {player && selectedDrama && (
        <PlayerModal drama={selectedDrama} initial={player} onClose={() => setPlayer(null)} />
      )}
    </div>
  );
}

function DramaCard({ drama, index, onOpen }: { drama: Drama; index: number; onOpen: (drama: Drama) => void }) {
  const tags = drama.generos?.length ? drama.generos : drama.tags?.length ? drama.tags : [drama.tipo === 'shortDrama' ? 'Mini drama' : 'Dorama'];
  return (
    <button className="drama-card" onClick={() => onOpen(drama)} style={{ animationDelay: `${Math.min(index * 45, 400)}ms` }}>
      <div className="card-cover-wrap">
        <img className="card-cover" src={coverFor(drama)} alt={`Capa de ${drama.titulo}`} loading={index < 4 ? 'eager' : 'lazy'} />
        <div className="card-cover-shade" />
        {drama.novo && <span className="new-badge">NOVO</span>}
        <span className="card-number">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="card-info">
        <div className="chip-row">{tags.slice(0, 2).map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>
        <h2>{drama.titulo}</h2>
        <p>{drama.sinopse || 'Uma nova história está esperando por você.'}</p>
        <span className="card-cta">abrir dorama <span>↗</span></span>
      </div>
      <span className="card-arrow">→</span>
    </button>
  );
}

function DetailView({ drama, loading, error, onBack, onOpenEpisode }: { drama: Drama | null; loading: boolean; error: string; onBack: () => void; onOpenEpisode: (episode: FlatEpisode) => void }) {
  const episodes = useMemo(() => flattenEpisodes(drama), [drama]);
  if (!drama && loading) return <main className="detail-page"><div className="detail-loading"><span className="spinner" /> abrindo a história…</div></main>;
  if (!drama) return <main className="detail-page"><ErrorPanel message={error || 'Dorama não encontrado.'} onRetry={onBack} /></main>;

  return (
    <main className="detail-page">
      <button className="back-button" onClick={onBack}>← catálogo</button>
      <section className="detail-hero">
        <div className="detail-cover-frame"><img src={coverFor(drama)} alt={`Capa de ${drama.titulo}`} /></div>
        <div className="detail-copy">
          <p className="eyebrow">SELEÇÃO DRAMA REELS</p>
          <h1>{drama.titulo}</h1>
          <div className="detail-meta"><span>{drama.totalEpisodios || episodes.length} episódios</span><span>{drama.anoLancamento || '2026'}</span><span>{drama.idiomaTagManual || drama.idioma || 'Dublado'}</span></div>
          <p className="detail-synopsis">{drama.sinopse || 'Uma história para assistir no seu ritmo, episódio após episódio.'}</p>
          <div className="detail-actions"><button className="primary-button" onClick={() => episodes[0] && onOpenEpisode(episodes[0])}>▶ assistir agora</button><span className="swipe-hint">deslize para navegar</span></div>
        </div>
      </section>

      {error && <ErrorPanel message={error} onRetry={() => window.location.reload()} />}
      <section className="episodes-section">
        <div className="section-heading"><div><p className="eyebrow">CONTINUE DE ONDE PAROU</p><h2>Todos os episódios</h2></div><span>{episodes.length} disponíveis</span></div>
        {drama.temporadas?.map((season: Season) => (
          <div className="season-block" key={season.numero}>
            <div className="season-heading"><span>{String(season.numero).padStart(2, '0')}</span><h3>{season.titulo}</h3></div>
            <div className="episode-grid">{season.episodios.map((episode) => <button className="episode-card" key={`${season.numero}-${episode.numero}`} onClick={() => onOpenEpisode({ ...episode, seasonNumber: season.numero, seasonTitle: season.titulo })}>
              <span className="episode-thumb">{episode.thumbnail ? <img src={episode.thumbnail} alt="" /> : <span>{String(episode.numero).padStart(2, '0')}</span>}<i>▶</i></span>
              <span className="episode-text"><strong>Episódio {episode.numero}</strong><small>{formatDuration(episode.duracaoSegundos) || 'assistir agora'}</small></span>
            </button>)}</div>
          </div>
        ))}
      </section>
    </main>
  );
}

function PlayerModal({ drama, initial, onClose }: { drama: Drama; initial: { season: number; episode: number }; onClose: () => void }) {
  const episodes = useMemo(() => flattenEpisodes(drama), [drama]);
  const initialIndex = Math.max(0, episodes.findIndex((episode) => episode.seasonNumber === initial.season && episode.numero === initial.episode));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [videoUrl, setVideoUrl] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<unknown>(null);
  const current = episodes[activeIndex];

  const loadEpisode = useCallback(async (index: number) => {
    const episode = episodes[index];
    if (!episode) return;
    setActiveIndex(index);
    setVideoUrl('');
    setSourceUrl('');
    setError('');
    setPaused(false);
    try {
      const stream = await startStream(drama._id, episode.seasonNumber, episode.numero, 'mp4');
      if (!stream.urlVideo) throw new Error('O servidor não retornou um vídeo para este episódio.');
      setSourceUrl(stream.urlVideo);
      setVideoUrl(stream.urlVideo);
      if (stream.streamSessionId) setSessionId(stream.streamSessionId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar este episódio.');
    }
  }, [drama._id, episodes]);

  useEffect(() => { void loadEpisode(initialIndex); }, [initialIndex, loadEpisode]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (sessionId) void heartbeat(sessionId); }, 25000);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  useEffect(() => () => { if (sessionId) void endStream(sessionId); }, [sessionId]);

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowDown') void loadEpisode(Math.min(episodes.length - 1, activeIndex + 1));
      if (event.key === 'ArrowUp') void loadEpisode(Math.max(0, activeIndex - 1));
    };
    window.addEventListener('keydown', keyHandler);
    return () => window.removeEventListener('keydown', keyHandler);
  }, [activeIndex, episodes.length, loadEpisode, onClose]);

  const moveEpisode = (direction: 1 | -1) => void loadEpisode(Math.max(0, Math.min(episodes.length - 1, activeIndex + direction)));
  const handleTouchEnd = (clientY: number) => {
    if (touchStart === null) return;
    const difference = touchStart - clientY;
    if (Math.abs(difference) > 55) moveEpisode(difference > 0 ? 1 : -1);
    setTouchStart(null);
  };
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) { void videoRef.current.play(); setPaused(false); } else { videoRef.current.pause(); setPaused(true); }
  };

  return (
    <div className="player-modal" role="dialog" aria-modal="true" aria-label="Player vertical">
      <div className="player-shell" onTouchStart={(event) => setTouchStart(event.touches[0].clientY)} onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0].clientY)} onWheel={(event) => { if (Math.abs(event.deltaY) > 40) moveEpisode(event.deltaY > 0 ? 1 : -1); }} onClick={() => setControlsVisible((visible) => !visible)}>
        <div className="player-topline"><span className="player-brand">DRAMA <b>REELS</b></span><span>{String(activeIndex + 1).padStart(2, '0')} <i>/</i> {String(episodes.length).padStart(2, '0')}</span></div>
        <div className="player-progress"><span style={{ width: `${((activeIndex + 1) / Math.max(episodes.length, 1)) * 100}%` }} /></div>
        {videoUrl ? <video ref={videoRef} key={videoUrl} className="player-video" src={videoUrl} autoPlay playsInline muted={muted} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} onError={() => {
          if (sourceUrl && videoUrl === sourceUrl) {
            setError('Convertendo o vídeo para um formato compatível…');
            setVideoUrl(`/media?url=${encodeURIComponent(sourceUrl)}`);
          } else {
            setError('O navegador não conseguiu decodificar este vídeo.');
          }
        }} /> : <div className="player-loading"><span className="spinner" /><p>preparando episódio {current?.numero || ''}</p></div>}
        <div className="player-vignette" />
        {controlsVisible && <>
          <button className="player-close" onClick={(event) => { event.stopPropagation(); onClose(); }}>× <span>fechar</span></button>
          <div className="player-copy"><p className="eyebrow">{current?.seasonTitle || 'EPISÓDIO'}</p><h2>{drama.titulo}</h2><p>Episódio {current?.numero || '—'} <span>·</span> deslize para continuar</p></div>
          <div className="player-controls" onClick={(event) => event.stopPropagation()}><button onClick={() => moveEpisode(-1)} disabled={activeIndex === 0} aria-label="Episódio anterior">↑</button><button className="play-button" onClick={togglePlay} aria-label={paused ? 'Reproduzir' : 'Pausar'}>{paused ? '▶' : 'Ⅱ'}</button><button onClick={() => moveEpisode(1)} disabled={activeIndex === episodes.length - 1} aria-label="Próximo episódio">↓</button><button onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Ativar som' : 'Desativar som'}>{muted ? '⌁' : '◖'}</button></div>
          {error && <div className="player-error" onClick={(event) => event.stopPropagation()}><strong>Não carregou</strong><span>{error}</span><button onClick={() => void loadEpisode(activeIndex)}>tentar de novo</button></div>}
          <div className="swipe-label"><span>↑</span><span>deslize</span></div>
        </>}
      </div>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-panel"><span className="error-icon">!</span><div><strong>Algo saiu do roteiro.</strong><p>{message}</p></div><button onClick={onRetry}>tentar novamente</button></div>;
}

function CatalogSkeleton() {
  return <section className="catalog-list">{Array.from({ length: 4 }).map((_, index) => <div className="skeleton-card" key={index}><div className="skeleton-cover" /><div className="skeleton-lines"><span /><span /><span /></div></div>)}</section>;
}
