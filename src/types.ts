export type Drama = {
  _id: string;
  titulo: string;
  slug?: string;
  sinopse?: string;
  tipo?: string;
  pacote?: string;
  idioma?: string;
  idiomaTagManual?: string;
  pais?: string;
  anoLancamento?: number;
  classificacaoIndicativa?: string;
  capaPrincipal?: string;
  capaVertical?: string;
  thumbnail?: string;
  trailer?: string;
  totalEpisodios?: number;
  totalVisualizacoes?: number;
  avaliacao?: number;
  generos?: string[];
  tags?: string[];
  novo?: boolean;
  destaque?: boolean;
  gratis?: boolean;
  temporadas?: Season[];
};

export type Category = {
  nome: string;
  slug: string;
  tipo?: string;
};

export type Season = {
  numero: number;
  titulo: string;
  episodios: Episode[];
};

export type Episode = {
  _id?: string;
  numero: number;
  titulo: string;
  descricao?: string;
  duracaoSegundos?: number;
  thumbnail?: string;
  gratis?: boolean;
  publicado?: boolean;
  urlVideo?: string;
  urlVideoExpiraEm?: number;
};

export type Pagination = {
  total: number;
  pagina: number;
  totalPaginas: number;
};

export type DramaPage = {
  sucesso: boolean;
  dados: Drama[];
  paginacao?: Pagination;
  mensagem?: string;
};

export type StreamResponse = {
  sucesso: boolean;
  dados?: {
    urlVideo?: string;
    streamSessionId?: string;
    episodios?: Episode[];
  };
  mensagem?: string;
};
