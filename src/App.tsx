import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ensureVisitor, getCatalogInfo, getDrama, listCategories, listDramas } from './api';
import type { Category, Drama, Episode, Season } from './types';

const FALLBACK_COVER = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=80';
const PAGE_LIMIT = 24;
const SEARCH_DEBOUNCE_MS = 600;

type Screen = 'catalog' | 'detail';
type PlayerState = { season: number; episode: number } | null;
type FlatEpisode = Episode & { seasonNumber: number; seasonTitle: string };
type DramaWatchProgress = { seasonNumber: number; episodeNumber: number; positionSeconds: number; watchedEpisodes: string[] };
type WatchProgressMap = Record<string, DramaWatchProgress>;
type InstallPlatform = 'ios' | 'android' | 'other';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type WebkitVideoElement = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: 'inline' | 'picture-in-picture' | 'fullscreen') => boolean;
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture' | 'fullscreen') => void;
  webkitPresentationMode?: 'inline' | 'picture-in-picture' | 'fullscreen';
};

const TABS = [
  { id: 'mylist', label: 'Minha lista' },
  { id: 'todos', label: 'Todos' },
  { id: 'recentes', label: 'Novidades' },
  { id: 'vistos', label: 'Em alta' },
];

function tabRequest(tab: string): { sort: string; tag: string } {
  if (tab === 'recentes') return { sort: 'recentes', tag: '' };
  if (tab === 'vistos') return { sort: 'vistos', tag: '' };
  if (tab === 'todos' || tab === 'mylist' || tab === '') return { sort: 'destaque', tag: '' };
  return { sort: 'destaque', tag: tab };
}

function coverFor(drama: Drama) {
  return drama.capaVertical || drama.capaPrincipal || drama.thumbnail || FALLBACK_COVER;
}

function detectInstallPlatform(): InstallPlatform {
  const userAgent = navigator.userAgent || '';
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(userAgent) || isIPadOS) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

function isAppInstalled() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches === true || navigatorWithStandalone.standalone === true;
}

function pictureInPictureHelp() {
  if (detectInstallPlatform() === 'ios' && isAppInstalled()) {
    return 'No iPhone, o modo flutuante pode não funcionar quando o app é aberto pela Tela de Início. Tente abrir o dorama pelo Safari.';
  }
  if (detectInstallPlatform() === 'ios') {
    return 'No iPhone, a disponibilidade da janela flutuante depende do navegador e do vídeo. Se você abriu por outro navegador, tente pelo Safari.';
  }
  return 'Este navegador ou aparelho não oferece janela flutuante para este vídeo. O episódio continua aberto neste player.';
}

function recoverCover(event: React.SyntheticEvent<HTMLImageElement>) {
  const node = event.currentTarget;
  if (node.dataset.fallback === '1') return;
  node.dataset.fallback = '1';
  node.src = FALLBACK_COVER;
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
  return `${Math.floor(seconds / 60)} min`;
}

function formatTime(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function durationFromVideo(video: HTMLVideoElement) {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  if (video.seekable.length) {
    const end = video.seekable.end(video.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) return end;
  }
  if (video.buffered.length) {
    const end = video.buffered.end(video.buffered.length - 1);
    if (Number.isFinite(end) && end > 0) return end;
  }
  return 0;
}

function compactNumber(value?: number) {
  if (!value) return '';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace('.0', '')}K`;
  return String(value);
}

const MY_LIST_STORAGE_KEY = 'drama-reels-minha-lista';
const WATCH_PROGRESS_STORAGE_KEY = 'drama-reels-watch-progress-v1';

function episodeProgressKey(seasonNumber: number, episodeNumber: number) {
  return `${seasonNumber}:${episodeNumber}`;
}

function readMyList(): Drama[] {
  try {
    const stored = window.localStorage.getItem(MY_LIST_STORAGE_KEY);
    return stored ? JSON.parse(stored) as Drama[] : [];
  } catch {
    return [];
  }
}

function readWatchProgress(): WatchProgressMap {
  try {
    const stored = window.localStorage.getItem(WATCH_PROGRESS_STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const progress: WatchProgressMap = {};
    Object.entries(parsed).forEach(([dramaId, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const entry = value as Partial<DramaWatchProgress>;
      const seasonNumber = Number(entry.seasonNumber);
      const episodeNumber = Number(entry.episodeNumber);
      const positionSeconds = Number(entry.positionSeconds);
      if (!Number.isFinite(seasonNumber) || seasonNumber < 0 || !Number.isFinite(episodeNumber) || episodeNumber < 1) return;
      const watchedEpisodes = Array.isArray(entry.watchedEpisodes)
        ? [...new Set(entry.watchedEpisodes.filter((key): key is string => typeof key === 'string' && /^\d+:\d+$/.test(key)))].slice(-500)
        : [];
      progress[dramaId] = { seasonNumber, episodeNumber, positionSeconds: Number.isFinite(positionSeconds) && positionSeconds > 0 ? positionSeconds : 0, watchedEpisodes };
    });
    return progress;
  } catch {
    return {};
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('catalog');
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [myList, setMyList] = useState<Drama[]>(readMyList);
  const [watchProgress, setWatchProgress] = useState<WatchProgressMap>(readWatchProgress);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState('todos');
  const [selectedDrama, setSelectedDrama] = useState<Drama | null>(null);
  const [player, setPlayer] = useState<PlayerState>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [noNewTitles, setNoNewTitles] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [visitorReady, setVisitorReady] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [installPlatform, setInstallPlatform] = useState<InstallPlatform>('other');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const bootStartedRef = useRef(false);
  const requestRef = useRef(0);
  const loadingRef = useRef(false);
  const autoLoadAfterItemsRef = useRef(true);
  const pageRef = useRef(1);
  const tabRef = useRef('todos');
  const queryRef = useRef('');

  useEffect(() => {
    try {
      window.localStorage.setItem(WATCH_PROGRESS_STORAGE_KEY, JSON.stringify(watchProgress));
    } catch {
      // A reprodução permanece disponível mesmo se o armazenamento estiver cheio ou desativado.
    }
  }, [watchProgress]);

  useEffect(() => {
    setInstallPlatform(detectInstallPlatform());
    setAppInstalled(isAppInstalled());
    const beforeInstallHandler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const installedHandler = () => {
      setAppInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', beforeInstallHandler as EventListener);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstallHandler as EventListener);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) {
      setInstallHelpOpen(true);
      return;
    }
    const prompt = installPrompt;
    setInstallPrompt(null);
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === 'accepted') setAppInstalled(true);
    } catch {
      setInstallHelpOpen(true);
    }
  };

  const loadCatalog = useCallback(async (options: { page: number; replace?: boolean; query?: string; tab?: string }) => {
    const tab = options.tab ?? tabRef.current;
    const query = options.query ?? queryRef.current;
    tabRef.current = tab;
    queryRef.current = query;

    if (tab === 'mylist') {
      requestRef.current += 1;
      loadingRef.current = false;
      autoLoadAfterItemsRef.current = false;
      setNoNewTitles(false);
      setDramas(readMyList());
      setPage(1);
      pageRef.current = 1;
      setHasMore(false);
      setCatalogError('');
      setLoading(false);
      return;
    }

    const requestId = ++requestRef.current;
    const { sort, tag } = tabRequest(tab);
    setCatalogError('');
    loadingRef.current = true;
    setLoading(true);
    try {
      const result = await listDramas(options.page, PAGE_LIMIT, query, sort, tag);
      if (requestId !== requestRef.current) return;
      autoLoadAfterItemsRef.current = result.dramas.length > 0;
      setNoNewTitles(options.page > 1 && !query && result.dramas.length === 0);
      setCatalogTotal(result.pagination.total || getCatalogInfo().total);
      setDramas((current) => {
        const base = options.replace ? [] : current;
        const seen = new Set(base.map((drama) => drama._id));
        return [...base, ...result.dramas.filter((drama) => !seen.has(drama._id))];
      });
      pageRef.current = options.page;
      setPage(options.page);
      setHasMore(result.pagination.mais !== false && options.page < (result.pagination.totalPaginas || 1));
    } catch (error) {
      if (requestId !== requestRef.current) return;
      autoLoadAfterItemsRef.current = false;
      setNoNewTitles(false);
      setCatalogError('Não foi possível carregar as histórias agora. Tente novamente em instantes.');
      if (options.page > 1) setHasMore(false);
    } finally {
      if (requestId === requestRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    (async () => {
      try {
        await ensureVisitor();
        setVisitorReady(true);
      } catch (error) {
        setCatalogError('Não foi possível iniciar agora. Tente novamente em instantes.');
        setLoading(false);
      }
      try {
        setCategories(await listCategories());
      } catch {
        setCategories([]);
      }
    })();
  }, []);

  // Um único efeito dispara o reload: troca de aba, término da digitação ou
  // pronta da sessão. Antes havia três efeitos sobrepostos que lançavam a
  // mesma requisição duas vezes e desperdiçavam a cota diária da API.
  useEffect(() => {
    if (!visitorReady) return;
    void loadCatalog({ page: 1, replace: true, query: searchQuery, tab: activeTab });
  }, [activeTab, loadCatalog, searchQuery, visitorReady]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      if (loadingRef.current || !visitorReady) return;
      if (!autoLoadAfterItemsRef.current) return;
      void loadCatalog({ page: pageRef.current + 1 });
    }, { rootMargin: '900px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeTab, hasMore, loadCatalog, visitorReady]);

  const openDrama = async (drama: Drama) => {
    window.history.pushState({}, '', `/drama/${drama._id}`);
    setScreen('detail');
    setDetailError('');
    setDetailLoading(true);
    setSelectedDrama(drama);
    try {
      setSelectedDrama(await getDrama(drama._id));
    } catch (error) {
      setDetailError('Não foi possível abrir esta história agora. Tente novamente em instantes.');
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

  const selectTab = (tab: string) => {
    if (tab === activeTab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const rememberDrama = useCallback((drama: Drama) => {
    setMyList((current) => {
      const next = [drama, ...current.filter((item) => item._id !== drama._id)].slice(0, 100);
      try {
        window.localStorage.setItem(MY_LIST_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // O catálogo continua funcionando mesmo se o armazenamento estiver indisponível.
      }
      return next;
    });
  }, []);

  const recordWatchProgress = useCallback((dramaId: string, episode: FlatEpisode, completed = false, positionSeconds?: number) => {
    const key = episodeProgressKey(episode.seasonNumber, episode.numero);
    setWatchProgress((current) => {
      const previous = current[dramaId];
      const sameEpisode = previous?.seasonNumber === episode.seasonNumber && previous.episodeNumber === episode.numero;
      const watchedEpisodes = completed
        ? [...new Set([...(previous?.watchedEpisodes ?? []), key])].slice(-500)
        : previous?.watchedEpisodes ?? [];
      const savedPosition = completed
        ? 0
        : typeof positionSeconds === 'number' && Number.isFinite(positionSeconds)
          ? Math.max(0, positionSeconds)
          : sameEpisode ? previous?.positionSeconds ?? 0 : 0;
      return {
        ...current,
        [dramaId]: {
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.numero,
          positionSeconds: savedPosition,
          watchedEpisodes,
        },
      };
    });
  }, []);

  const handlePlayerStarted = useCallback((episode: FlatEpisode) => {
    if (!selectedDrama) return;
    rememberDrama(selectedDrama);
    recordWatchProgress(selectedDrama._id, episode);
  }, [recordWatchProgress, rememberDrama, selectedDrama]);

  const handleEpisodeCompleted = useCallback((episode: FlatEpisode) => {
    if (selectedDrama) recordWatchProgress(selectedDrama._id, episode, true);
  }, [recordWatchProgress, selectedDrama]);

  const handlePlayerPositionChanged = useCallback((episode: FlatEpisode, positionSeconds: number) => {
    if (selectedDrama) recordWatchProgress(selectedDrama._id, episode, false, positionSeconds);
  }, [recordWatchProgress, selectedDrama]);

  const visibleDramas = activeTab === 'mylist' ? myList : dramas;
  const loadedCount = visibleDramas.length;
  const heroTotal = catalogTotal || getCatalogInfo().total || loadedCount;

  const openEpisode = (episode: FlatEpisode) => setPlayer({ season: episode.seasonNumber, episode: episode.numero });

  const routeDramaId = window.location.pathname.startsWith('/drama/') ? window.location.pathname.split('/')[2] : null;
  useEffect(() => {
    if (routeDramaId && dramas.length && screen === 'catalog') {
      const match = dramas.find((drama) => drama._id === routeDramaId);
      if (match) void openDrama(match);
    }
    // A rota inicial é lida uma vez, quando o catálogo já tem itens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dramas.length, routeDramaId]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={closeDetail} aria-label="Voltar ao catálogo">
          <span className="brand-mark">▮</span>
          <span>Drama <b>Reels</b></span>
        </button>
        <div className="topbar-actions">
          <div className="topbar-meta"><span className="live-dot" /> catálogo dublado em português</div>
          {!appInstalled && <button className="install-app-button" type="button" onClick={() => void handleInstallApp()} aria-haspopup="dialog">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
            <span>Instalar app</span>
          </button>}
        </div>
      </header>

      {screen === 'catalog' ? (
        <main className="catalog-page">
          <section className="catalog-hero">
            <div>
              <p className="eyebrow">DESCUBRA A PRÓXIMA HISTÓRIA</p>
              <h1>Escolha uma história<span>.</span></h1>
              <p className="hero-copy">Histórias dubladas para curtir sem pressa. Escolha uma e prepare a maratona.</p>
            </div>
            <div className="hero-stat"><strong>{heroTotal || '—'}</strong><span>doramas dublados disponíveis</span></div>
          </section>

          <div className="catalog-search" role="search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void setSearchQuery(searchInput.trim());
                }
              }}
              placeholder="Pesquisar em toda a biblioteca dublada"
              aria-label="Pesquisar dorama por título"
            />
            {searchInput && <button type="button" className="clear-search" onClick={() => setSearchInput('')} aria-label="Limpar pesquisa">×</button>}
          </div>

          {searchQuery && (
            <p className="search-status" aria-live="polite">
              {loading && searchQuery === searchInput.trim() ? 'buscando em toda a biblioteca…' : `${loadedCount} resultado${loadedCount === 1 ? '' : 's'} para “${searchQuery}”`}
            </p>
          )}

          <nav className="category-tabs" aria-label="Ordenações e categorias">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'category-tab active' : 'category-tab'}
                type="button"
                onClick={() => selectTab(tab.id)}
                aria-selected={activeTab === tab.id}
              >
                {tab.label}{tab.id === 'mylist' && myList.length > 0 ? ` (${myList.length})` : ''}
              </button>
            ))}
            {categories.map((category) => (
              <button
                className={activeTab === category.slug ? 'category-tab active' : 'category-tab'}
                type="button"
                key={`${category.slug}-${category.nome}`}
                onClick={() => selectTab(category.slug)}
                aria-selected={activeTab === category.slug}
              >
                {category.nome}{category.count ? ` · ${category.count}` : ''}
              </button>
            ))}
          </nav>

          {catalogError && <ErrorPanel message={catalogError} onRetry={() => void loadCatalog({ page: activeTab === 'mylist' ? 1 : page, replace: page === 1 })} />}
          {loading && loadedCount === 0 ? <CatalogSkeleton /> : (
            loadedCount > 0 ? <section className="catalog-list" aria-label="Lista de doramas">
              {visibleDramas.map((drama, index) => <DramaCard key={`${drama._id}-${index}`} drama={drama} index={index} onOpen={openDrama} />)}
            </section> : <div className="no-results">{activeTab === 'mylist' ? 'Os doramas que você começar a assistir aparecerão aqui.' : searchQuery ? `Nenhum dorama dublado encontrado para “${searchQuery}”.` : 'Nenhum dorama encontrado nesta seleção.'}</div>
          )}
          <div ref={sentinelRef} className="catalog-sentinel">
            {loading && loadedCount > 0 ? <span>carregando mais histórias…</span> : hasMore ? <>
              {noNewTitles && <span aria-live="polite">Ainda não apareceu uma história nova. Você pode carregar mais.</span>}
              <span>deslize para carregar mais histórias</span>
              <button className="load-more-button" type="button" onClick={() => void loadCatalog({ page: page + 1 })}>carregar mais</button>
            </> : loadedCount > 0 ? <span>fim da seleção · {loadedCount} de {heroTotal || loadedCount} títulos</span> : null}
          </div>
        </main>
      ) : (
        <DetailView
          drama={selectedDrama}
          loading={detailLoading}
          error={detailError}
          progress={selectedDrama ? watchProgress[selectedDrama._id] ?? null : null}
          onBack={closeDetail}
          onOpenEpisode={openEpisode}
        />
      )}

      {player && selectedDrama && (
        <PlayerModal drama={selectedDrama} initial={player} progress={watchProgress[selectedDrama._id] ?? null} onClose={() => setPlayer(null)} onStarted={handlePlayerStarted} onEpisodeCompleted={handleEpisodeCompleted} onPositionChanged={handlePlayerPositionChanged} />
      )}
      {installHelpOpen && <InstallHelpModal platform={installPlatform} onClose={() => setInstallHelpOpen(false)} />}
    </div>
  );
}

function DramaCard({ drama, index, onOpen }: { drama: Drama; index: number; onOpen: (drama: Drama) => void }) {
  const tags = drama.generos?.length ? drama.generos : drama.tags?.length ? drama.tags : ['Mini drama dublado'];
  const plays = compactNumber(drama.visualizacoes) || compactNumber(drama.favoritos);
  return (
    <button className="drama-card" onClick={() => onOpen(drama)} style={{ animationDelay: `${Math.min(index * 45, 400)}ms` }}>
      <div className="card-cover-wrap">
        <img className="card-cover" src={coverFor(drama)} alt={`Capa de ${drama.titulo}`} loading={index < 4 ? 'eager' : 'lazy'} onError={recoverCover} />
        <div className="card-cover-shade" />
        <span className="dub-badge">DUBLADO PT</span>
        <span className="card-number">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="card-info">
        <div className="chip-row">{tags.slice(0, 2).map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>
        <h2>{drama.titulo}</h2>
        <p>{drama.sinopse || 'Uma nova história está esperando por você.'}</p>
        <span className="card-cta">abrir dorama <span>↗</span>{drama.totalEpisodios ? <em>{drama.totalEpisodios} episódios</em> : null}{plays ? <em>{plays} assistidos</em> : null}</span>
      </div>
      <span className="card-arrow">→</span>
    </button>
  );
}

function DetailView({ drama, loading, error, progress, onBack, onOpenEpisode }: { drama: Drama | null; loading: boolean; error: string; progress: DramaWatchProgress | null; onBack: () => void; onOpenEpisode: (episode: FlatEpisode) => void }) {
  const episodes = useMemo(() => flattenEpisodes(drama), [drama]);
  const savedEpisode = progress ? episodes.find((episode) => episode.seasonNumber === progress.seasonNumber && episode.numero === progress.episodeNumber) : undefined;
  const savedEpisodeCompleted = savedEpisode ? progress?.watchedEpisodes.includes(episodeProgressKey(savedEpisode.seasonNumber, savedEpisode.numero)) ?? false : false;
  const primaryEpisode = savedEpisode?.urlVideo ? savedEpisode : episodes.find((episode) => episode.urlVideo);
  const isResuming = Boolean(primaryEpisode && savedEpisode === primaryEpisode && !savedEpisodeCompleted);
  const isReplaying = Boolean(primaryEpisode && savedEpisode === primaryEpisode && savedEpisodeCompleted);
  const primaryActionLabel = !primaryEpisode ? 'episódio em breve' : isResuming ? '▶ continuar assistindo' : isReplaying ? '▶ assistir novamente' : '▶ assistir agora';
  const primaryActionHint = isResuming ? `retomar temporada ${primaryEpisode?.seasonNumber} · episódio ${primaryEpisode?.numero}` : isReplaying ? 'último episódio concluído' : primaryEpisode ? 'Escolha uma história e aproveite.' : error || 'Novos episódios podem aparecer em breve.';
  if (!drama && loading) return <main className="detail-page"><div className="detail-loading"><span className="spinner" /> abrindo a história…</div></main>;
  if (!drama) return <main className="detail-page"><ErrorPanel message={error || 'Dorama não encontrado.'} onRetry={onBack} /></main>;

  return (
    <main className="detail-page">
      <button className="back-button" onClick={onBack}>← catálogo</button>
      <section className="detail-hero">
        <div className="detail-cover-frame"><img src={coverFor(drama)} alt={`Capa de ${drama.titulo}`} onError={recoverCover} /></div>
        <div className="detail-copy">
          <p className="eyebrow">SELEÇÃO DRAMA REELS</p>
          <h1>{drama.titulo}</h1>
          <div className="detail-meta"><span>{drama.totalEpisodios || episodes.length} episódios</span><span>{drama.anoLancamento || '2026'}</span><span>{drama.idiomaTagManual || 'Dublado'}</span></div>
          <p className="detail-synopsis">{drama.sinopse || 'Uma história para assistir no seu ritmo, episódio após episódio.'}</p>
          <div className="detail-actions"><button className="primary-button" type="button" disabled={!primaryEpisode} onClick={() => primaryEpisode && onOpenEpisode(primaryEpisode)}>{primaryActionLabel}</button><span className="swipe-hint">{primaryActionHint}</span></div>
        </div>
      </section>

      {error && <ErrorPanel message={error} onRetry={() => window.location.reload()} />}
      <section className="episodes-section">
        <div className="section-heading"><div><p className="eyebrow">CONTINUE DE ONDE PAROU</p><h2>Todos os episódios</h2></div><span>{episodes.length} disponíveis</span></div>
        <p className="detail-synopsis">{episodes.some((episode) => episode.urlVideo) ? 'Escolha um episódio e aproveite a história.' : error || 'Novos episódios podem aparecer em breve.'}</p>
        {drama.temporadas?.map((season: Season) => (
          <div className="season-block" key={season.numero}>
            <div className="season-heading"><span>{String(season.numero).padStart(2, '0')}</span><h3>{season.titulo}</h3></div>
            <div className="episode-grid">{season.episodios.map((episode) => {
              const progressKey = episodeProgressKey(season.numero, episode.numero);
              const isWatched = progress?.watchedEpisodes.includes(progressKey) ?? false;
              const isCurrent = progress?.seasonNumber === season.numero && progress.episodeNumber === episode.numero && !isWatched;
              const episodeClass = `episode-card${isWatched ? ' is-watched' : ''}${isCurrent ? ' is-resume' : ''}`;
              return <button className={episodeClass} type="button" disabled={!episode.urlVideo} key={`${season.numero}-${episode.numero}`} onClick={() => episode.urlVideo && onOpenEpisode({ ...episode, seasonNumber: season.numero, seasonTitle: season.titulo })} aria-label={`Temporada ${season.numero}, episódio ${episode.numero}${isWatched ? ', assistido' : isCurrent ? ', continuar assistindo' : ''}`}>
                <span className="episode-thumb">{episode.thumbnail ? <img src={episode.thumbnail} alt="" onError={recoverCover} /> : <span>{String(episode.numero).padStart(2, '0')}</span>}<i>{episode.urlVideo ? '▶' : '—'}</i></span>
                <span className="episode-text"><strong>Episódio {episode.numero}</strong><small>{isCurrent ? 'continuar assistindo' : isWatched ? 'assistido' : formatDuration(episode.duracaoSegundos) || (episode.urlVideo ? 'assistir agora' : 'em breve')}</small></span>
                {(isWatched || isCurrent) && <span className="episode-status">{isWatched ? '✓ assistido' : 'retomar'}</span>}
              </button>;
            })}</div>
          </div>
        ))}
      </section>
    </main>
  );
}

function PlayerModal({ drama, initial, progress, onClose, onStarted, onEpisodeCompleted, onPositionChanged }: { drama: Drama; initial: { season: number; episode: number }; progress: DramaWatchProgress | null; onClose: () => void; onStarted: (episode: FlatEpisode) => void; onEpisodeCompleted: (episode: FlatEpisode) => void; onPositionChanged: (episode: FlatEpisode, positionSeconds: number) => void }) {
  const episodes = useMemo(() => flattenEpisodes(drama), [drama]);
  const initialIndex = Math.max(0, episodes.findIndex((episode) => episode.seasonNumber === initial.season && episode.numero === initial.episode));
  const initialEpisode = episodes[initialIndex];
  const initialResumeSeconds = initialEpisode && progress?.seasonNumber === initialEpisode.seasonNumber && progress.episodeNumber === initialEpisode.numero && !progress.watchedEpisodes.includes(episodeProgressKey(initialEpisode.seasonNumber, initialEpisode.numero))
    ? progress.positionSeconds
    : 0;
  const initialResumeSecondsRef = useRef(initialResumeSeconds);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [videoUrl, setVideoUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [pipActive, setPipActive] = useState(false);
  const [pipNotice, setPipNotice] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumePositionRef = useRef(0);
  const latestPositionRef = useRef(0);
  const lastSavedPositionRef = useRef(-1);
  const current = episodes[activeIndex];

  const loadEpisode = useCallback(async (index: number, resumeSeconds = 0) => {
    const episode = episodes[index];
    if (!episode) return;
    resumePositionRef.current = Math.max(0, resumeSeconds);
    latestPositionRef.current = resumePositionRef.current;
    lastSavedPositionRef.current = resumePositionRef.current;
    setActiveIndex(index);
    setVideoUrl('');
    setCurrentTime(0);
    setDuration(Number(episode.duracaoSegundos) || 0);
    setError('');
    setPaused(false);
    try {
      if (!episode.urlVideo) throw new Error('Este episódio não possui um vídeo disponível.');
      setVideoUrl(episode.urlVideo);
      onStarted(episode);
    } catch (requestError) {
        setError('Não foi possível carregar este episódio. Tente novamente ou escolha outro.');
    }
  }, [episodes, onStarted]);

  useEffect(() => { void loadEpisode(initialIndex, initialResumeSecondsRef.current); }, [initialIndex, loadEpisode]);

  const persistPlaybackPosition = useCallback((episode: FlatEpisode, seconds: number, force = false) => {
    const position = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    latestPositionRef.current = position;
    if (force || Math.abs(position - lastSavedPositionRef.current) >= 3) {
      lastSavedPositionRef.current = position;
      onPositionChanged(episode, position);
    }
  }, [onPositionChanged]);

  const saveCurrentPosition = useCallback(() => {
    if (!current) return;
    const videoTime = videoRef.current?.currentTime;
    const position = typeof videoTime === 'number' && Number.isFinite(videoTime) ? videoTime : latestPositionRef.current;
    persistPlaybackPosition(current, position, true);
  }, [current, persistPlaybackPosition]);

  const restoreSavedPosition = useCallback((video: HTMLVideoElement) => {
    const pending = resumePositionRef.current;
    if (pending <= 0) return;
    const mediaDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
    const target = mediaDuration > 0 ? Math.min(pending, Math.max(0, mediaDuration - 0.25)) : pending;
    try {
      video.currentTime = target;
      setCurrentTime(target);
      latestPositionRef.current = target;
      lastSavedPositionRef.current = target;
      if (Math.abs(video.currentTime - target) < 1 || video.seekable.length === 0) resumePositionRef.current = 0;
    } catch {
      // Algumas fontes HLS só aceitam o seek quando o primeiro trecho fica disponível.
    }
  }, [duration]);

  useEffect(() => {
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') saveCurrentPosition();
    };
    document.addEventListener('visibilitychange', persistWhenHidden);
    window.addEventListener('pagehide', saveCurrentPosition);
    return () => {
      document.removeEventListener('visibilitychange', persistWhenHidden);
      window.removeEventListener('pagehide', saveCurrentPosition);
    };
  }, [saveCurrentPosition]);

  useEffect(() => {
    if (!videoUrl || !videoRef.current) return;
    const video = videoRef.current;
    const isHls = videoUrl.toLowerCase().includes('.m3u8');
    const mediaUrl = isHls ? `/media/hls?url=${encodeURIComponent(videoUrl)}` : videoUrl;
    let cancelled = false;
    let destroyHls: (() => void) | undefined;
    if (!isHls || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = mediaUrl;
      void video.play().catch(() => setPaused(true));
      return;
    }
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setError('Este aparelho não conseguiu iniciar o episódio. Tente novamente ou escolha outro.');
        return;
      }
      const hls = new Hls({ enableWorker: true });
      destroyHls = () => hls.destroy();
      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        const totalDuration = data.details.totalduration;
        if (Number.isFinite(totalDuration) && totalDuration > 0) setDuration(totalDuration);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setError('Não foi possível iniciar este episódio. Tente novamente ou escolha outro.');
          setPaused(true);
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => setPaused(true));
      });
      hls.loadSource(mediaUrl);
      hls.attachMedia(video);
    }).catch(() => setError('Não foi possível iniciar este episódio. Tente novamente ou escolha outro.'));
    return () => {
      cancelled = true;
      destroyHls?.();
    };
  }, [videoUrl]);

  useEffect(() => {
    setPipActive(false);
    setPipNotice('');
    const video = videoRef.current as WebkitVideoElement | null;
    if (!video) return;
    const syncPipState = () => {
      setPipActive(document.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture');
    };
    video.addEventListener('enterpictureinpicture', syncPipState);
    video.addEventListener('leavepictureinpicture', syncPipState);
    video.addEventListener('webkitpresentationmodechanged', syncPipState);
    return () => {
      video.removeEventListener('enterpictureinpicture', syncPipState);
      video.removeEventListener('leavepictureinpicture', syncPipState);
      video.removeEventListener('webkitpresentationmodechanged', syncPipState);
    };
  }, [videoUrl]);

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { saveCurrentPosition(); onClose(); }
      if (event.key === 'ArrowDown') void loadEpisode(Math.min(episodes.length - 1, activeIndex + 1));
      if (event.key === 'ArrowUp') void loadEpisode(Math.max(0, activeIndex - 1));
    };
    window.addEventListener('keydown', keyHandler);
    return () => window.removeEventListener('keydown', keyHandler);
  }, [activeIndex, episodes.length, loadEpisode, onClose, saveCurrentPosition]);

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
  const handleSeek = (event: React.FormEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const video = videoRef.current;
    if (!video || !Number.isFinite(duration) || duration <= 0) return;
    const requestedTime = Number(event.currentTarget.value);
    if (!Number.isFinite(requestedTime)) return;
    const mediaDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
    const nextTime = Math.max(0, Math.min(mediaDuration, requestedTime));
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
    if (current) persistPlaybackPosition(current, nextTime, true);
  };

  const togglePictureInPicture = async () => {
    const video = videoRef.current as WebkitVideoElement | null;
    if (!video || !videoUrl) {
      setPipNotice('Aguarde o início do episódio antes de ativar a janela flutuante.');
      return;
    }
    setPipNotice('');
    try {
      if (video.webkitSupportsPresentationMode?.('picture-in-picture') && video.webkitSetPresentationMode) {
        const nextMode = video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
        video.webkitSetPresentationMode(nextMode);
        setPipActive(nextMode === 'picture-in-picture');
        return;
      }
      if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
        if (document.pictureInPictureElement === video && typeof document.exitPictureInPicture === 'function') {
          await document.exitPictureInPicture();
        } else {
          await video.requestPictureInPicture();
        }
        return;
      }
      setPipNotice(pictureInPictureHelp());
    } catch {
      setPipNotice(pictureInPictureHelp());
    }
  };

  return (
    <div className="player-modal" role="dialog" aria-modal="true" aria-label="Player vertical">
      <div className="player-shell" onTouchStart={(event) => setTouchStart(event.touches[0].clientY)} onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0].clientY)} onWheel={(event) => { if (Math.abs(event.deltaY) > 40) moveEpisode(event.deltaY > 0 ? 1 : -1); }} onClick={() => setControlsVisible((visible) => !visible)}>
        <div className="player-topline"><span className="player-brand">DRAMA <b>REELS</b></span><span>{String(activeIndex + 1).padStart(2, '0')} <i>/</i> {String(episodes.length).padStart(2, '0')}</span></div>
        <div className="player-progress" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
          <input type="range" min={0} max={duration || 0} step={0.25} value={Math.min(currentTime, duration || currentTime)} style={{ '--seek-progress': `${duration ? currentTime / duration * 100 : 0}%` } as React.CSSProperties} disabled={!duration} aria-label="Posição no episódio" aria-valuetext={`${formatTime(currentTime)} de ${formatTime(duration)}`} onInput={handleSeek} onChange={handleSeek} />
          <span className="player-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
        </div>
        {videoUrl ? <video ref={videoRef} key={videoUrl} className="player-video" autoPlay playsInline muted={muted} onLoadedMetadata={(event) => { const video = event.currentTarget; const next = durationFromVideo(video); if (next > 0) setDuration(next); restoreSavedPosition(video); }} onDurationChange={(event) => { const video = event.currentTarget; const next = durationFromVideo(video); if (next > 0) setDuration(next); restoreSavedPosition(video); }} onCanPlay={(event) => restoreSavedPosition(event.currentTarget)} onTimeUpdate={(event) => { const video = event.currentTarget; restoreSavedPosition(video); setCurrentTime(video.currentTime || 0); const next = durationFromVideo(video); if (next > 0) setDuration(next); if (current) persistPlaybackPosition(current, video.currentTime || 0); }} onPlay={() => setPaused(false)} onPause={() => setPaused(false)} onEnded={() => { if (current) onEpisodeCompleted(current); if (activeIndex < episodes.length - 1) moveEpisode(1); }} onError={() => setError('Não foi possível reproduzir este episódio. Tente novamente ou escolha outro.')} /> : <div className="player-loading"><span className="spinner" /><p>preparando episódio {current?.numero || ''}</p></div>}
        <div className="player-vignette" />
        {controlsVisible && <>
          <button className="player-close" onClick={(event) => { event.stopPropagation(); saveCurrentPosition(); onClose(); }}>× <span>fechar</span></button>
          <div className="player-copy"><p className="eyebrow">{current?.seasonTitle || 'EPISÓDIO'}</p><h2>{drama.titulo}</h2><p>Episódio {current?.numero || '—'} <span>·</span> deslize para continuar</p></div>
          <div className="player-controls" onClick={(event) => event.stopPropagation()}><button onClick={() => moveEpisode(-1)} disabled={activeIndex === 0} aria-label="Episódio anterior">↑</button><button className="play-button" onClick={togglePlay} aria-label={paused ? 'Reproduzir' : 'Pausar'}>{paused ? '▶' : 'Ⅱ'}</button><button onClick={() => moveEpisode(1)} disabled={activeIndex === episodes.length - 1} aria-label="Próximo episódio">↓</button><button onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Ativar som' : 'Desativar som'}>{muted ? '⌁' : '◖'}</button><button className={pipActive ? 'pip-button active' : 'pip-button'} type="button" onClick={() => void togglePictureInPicture()} aria-label={pipActive ? 'Sair da janela flutuante' : 'Janela flutuante'} aria-pressed={pipActive} title="Janela flutuante"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M12.5 12.5h6v5h-6z" /></svg></button></div>
          {pipNotice && <div className="pip-notice" role="status" onClick={(event) => event.stopPropagation()}><span>{pipNotice}</span><button type="button" onClick={() => setPipNotice('')} aria-label="Fechar aviso">×</button></div>}
          {error && <div className="player-error" onClick={(event) => event.stopPropagation()}><strong>Não carregou</strong><span>{error}</span><button onClick={() => void loadEpisode(activeIndex)}>tentar de novo</button></div>}
          <div className="swipe-label"><span>↑</span><span>deslize</span></div>
        </>}
      </div>
    </div>
  );
}

function InstallHelpModal({ platform, onClose }: { platform: InstallPlatform; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="install-overlay" role="presentation" onClick={onClose}>
      <section className="install-card" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}>
        <button className="install-close" type="button" onClick={onClose} aria-label="Fechar instruções">×</button>
        <div className="install-app-icon" aria-hidden="true"><span className="brand-mark">▮</span></div>
        <p className="eyebrow">SEU APP, NA TELA INICIAL</p>
        <h2 id="install-title">Leve o Drama Reels com você</h2>
        <p className="install-intro">Adicione o app à tela inicial para abrir suas histórias favoritas com um toque. É um web app — não precisa baixar APK.</p>
        {platform === 'ios' ? <div className="install-steps">
          <div className="install-step"><span>1</span><p><strong>Abra esta página no Safari</strong><small>Use o navegador Safari do iPhone ou iPad.</small></p></div>
          <div className="install-step"><span>2</span><p><strong>Toque em Compartilhar</strong><small>É o ícone de compartilhar na barra do Safari.</small></p></div>
          <div className="install-step"><span>3</span><p><strong>Escolha “Adicionar à Tela de Início”</strong><small>Confirme em “Adicionar” para concluir.</small></p></div>
        </div> : platform === 'android' ? <div className="install-steps">
          <div className="install-step"><span>1</span><p><strong>Use o Chrome</strong><small>Abra o Drama Reels no Chrome para Android.</small></p></div>
          <div className="install-step"><span>2</span><p><strong>Toque em “Instalar app”</strong><small>Se o aviso não aparecer, abra o menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”.</small></p></div>
        </div> : <div className="install-steps">
          <div className="install-step"><span>1</span><p><strong>Abra o menu do navegador</strong><small>Procure “Instalar app” ou “Adicionar à tela inicial”.</small></p></div>
          <div className="install-step"><span>2</span><p><strong>No iPhone, use o Safari</strong><small>Toque em Compartilhar e depois em “Adicionar à Tela de Início”.</small></p></div>
        </div>}
        <p className="install-footnote">As opções podem variar de acordo com o navegador e a versão do sistema.</p>
        <button className="install-done" type="button" onClick={onClose}>Entendi</button>
      </section>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-panel"><span className="error-icon">!</span><div><strong>Algo saiu do roteiro.</strong><p>{message}</p></div><button onClick={onRetry}>tentar novamente</button></div>;
}

function CatalogSkeleton() {
  return <section className="catalog-list">{Array.from({ length: 4 }).map((_, index) => <div className="skeleton-card" key={index}><div className="skeleton-cover" /><div className="skeleton-lines"><span /><span /><span /></div></div>)}</section>;
}
