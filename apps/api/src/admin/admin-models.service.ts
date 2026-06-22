import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateModelInput, UpdateModelInput } from '@embeding/schemas/admin';
import { PrismaService } from '../prisma/prisma.service';
import { ModelKind, Prisma } from '../prisma/client';
import { OllamaService } from '../ollama/ollama.service';

type DbModel = {
  id: string;
  ollamaName: string;
  displayName: string;
  kind: ModelKind;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Прогресс фоновой закачки модели — живёт на сервере, переживает уход клиента со страницы. */
export type PullView = {
  status: string;
  pct: number;
  done: boolean;
  error?: string;
};

type PullState = PullView & { finishedAt: number | null };

export type AdminModelDto = {
  id: string;
  ollamaName: string;
  displayName: string;
  kind: ModelKind;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

function toAdminModel(m: DbModel): AdminModelDto {
  return {
    id: m.id,
    ollamaName: m.ollamaName,
    displayName: m.displayName,
    kind: m.kind,
    isEnabled: m.isEnabled,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

// displayName не может содержать '/' (ломает путь /v1/models/:model).
function safeDisplayName(name: string): string {
  return name.replace(/\//g, '_');
}

@Injectable()
export class AdminModelsService {
  // Прогресс закачек по modelId. Закачка идёт фоном на сервере (не на клиентском
  // соединении), поэтому переживает навигацию/сворачивание вкладки. Фронт читает прогресс
  // через runtime()-поллинг — а не держит SSE-стрим, который рвётся при уходе со страницы.
  private readonly pulls = new Map<string, PullState>();
  // Сколько держать терминальное (done/error) состояние, чтобы поллинг успел его показать.
  private static readonly DONE_TTL_MS = 15_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ollama: OllamaService,
  ) {}

  async list(): Promise<AdminModelDto[]> {
    const rows = await this.prisma.model.findMany({
      orderBy: { displayName: 'asc' },
    });
    return rows.map(toAdminModel);
  }

  /** Загрузить модель в память (прогрев). Блокирует, пока Ollama не загрузит. */
  async load(id: string): Promise<{ ok: true }> {
    const model = await this.requireModel(id);
    await this.ollama.loadModel(model.ollamaName, model.kind);
    return { ok: true };
  }

  /** Выгрузить модель из памяти. */
  async unload(id: string): Promise<{ ok: true }> {
    const model = await this.requireModel(id);
    await this.ollama.unloadModel(model.ollamaName, model.kind);
    return { ok: true };
  }

  /**
   * Запустить фоновую закачку модели в Ollama. Идемпотентно: если закачка уже идёт — не дублирует.
   * Возвращает сразу; прогресс читается через runtime(). 404, если модель не зарегистрирована.
   */
  async startPull(id: string): Promise<{ started: boolean }> {
    const model = await this.requireModel(id);
    const cur = this.pulls.get(id);
    if (cur && !cur.done) return { started: false }; // уже качается
    this.pulls.set(id, { status: 'старт…', pct: 0, done: false, finishedAt: null });
    void this.runPull(id, model.ollamaName); // fire-and-forget: живёт независимо от запроса
    return { started: true };
  }

  /** Фоновый цикл закачки: читает прогресс Ollama и пишет его в this.pulls. */
  private async runPull(id: string, ollamaName: string): Promise<void> {
    try {
      const stream = await this.ollama.openPull(ollamaName);
      for await (const p of stream) {
        if (p.error) {
          this.finishPull(id, this.pulls.get(id)?.pct ?? 0, 'ошибка', p.error);
          return; // Ollama сообщила об ошибке строкой потока — не помечаем success
        }
        const total = p.total ?? 0;
        const completed = p.completed ?? 0;
        // На стадиях без total (verifying sha256 / writing manifest) держим прошлый %, не роняем в 0.
        const pct = total
          ? Math.round((completed / total) * 100)
          : (this.pulls.get(id)?.pct ?? 0);
        this.pulls.set(id, { status: p.status ?? '', pct, done: false, finishedAt: null });
      }
      this.finishPull(id, 100, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка скачивания';
      this.finishPull(id, this.pulls.get(id)?.pct ?? 0, 'ошибка', msg);
    }
  }

  private finishPull(id: string, pct: number, status: string, error?: string): void {
    this.pulls.set(id, { status, pct, done: true, error, finishedAt: Date.now() });
  }

  /** Состояние закачки для UI; протухшие терминальные состояния подчищает. */
  private pullView(id: string): PullView | null {
    const p = this.pulls.get(id);
    if (!p) return null;
    if (
      p.done &&
      p.finishedAt &&
      Date.now() - p.finishedAt > AdminModelsService.DONE_TTL_MS
    ) {
      this.pulls.delete(id);
      return null;
    }
    return { status: p.status, pct: p.pct, done: p.done, error: p.error };
  }

  /** Рантайм-статус: что сейчас в памяти (Ollama /api/ps) + прогресс фоновых закачек. */
  async runtime(): Promise<
    (AdminModelDto & {
      loaded: boolean;
      sizeBytes: number;
      expiresAt: string | null;
      pull: PullView | null;
    })[]
  > {
    const [models, running] = await Promise.all([
      this.prisma.model.findMany({ orderBy: { displayName: 'asc' } }),
      this.ollama.listRunning().catch(() => []),
    ]);
    return models.map((m) => {
      // Ollama в /api/ps может вернуть имя с тегом (:latest) — матчим точно и по имени без тега.
      const r = running.find(
        (x) => x.name === m.ollamaName || x.name.split(':')[0] === m.ollamaName,
      );
      return {
        ...toAdminModel(m),
        loaded: Boolean(r),
        sizeBytes: r?.sizeBytes ?? 0,
        expiresAt: r?.expiresAt ?? null,
        pull: this.pullView(m.id),
      };
    });
  }

  private async requireModel(id: string): Promise<DbModel> {
    const model = await this.prisma.model.findUnique({ where: { id } });
    if (!model) throw new NotFoundException('Модель не найдена');
    return model;
  }

  async create(dto: CreateModelInput): Promise<AdminModelDto> {
    try {
      const model = await this.prisma.model.create({
        data: {
          ollamaName: dto.ollamaName,
          displayName: dto.displayName ?? safeDisplayName(dto.ollamaName),
          kind: dto.kind,
          isEnabled: dto.isEnabled,
        },
      });
      return toAdminModel(model);
    } catch (e) {
      throw this.mapModelError(e);
    }
  }

  async update(id: string, dto: UpdateModelInput): Promise<AdminModelDto> {
    try {
      const model = await this.prisma.model.update({
        where: { id },
        data: {
          displayName: dto.displayName,
          kind: dto.kind,
          isEnabled: dto.isEnabled,
        },
      });
      return toAdminModel(model);
    } catch (e) {
      throw this.mapModelError(e); // P2002→409, P2025→404 (TOCTOU-гонка)
    }
  }

  async remove(id: string): Promise<void> {
    // Удаление модели, ограничивающей ключи, втихую расширило бы их права → запрещаем.
    const refs = await this.prisma.apiKeyModel.count({ where: { modelId: id } });
    if (refs > 0) {
      throw new ConflictException(
        'Модель привязана к API-ключам. Сначала отключите её (isEnabled=false) или измените ключи.',
      );
    }
    try {
      await this.prisma.model.delete({ where: { id } });
    } catch (e) {
      throw this.mapModelError(e); // P2025 → 404, если удалили в гонке
    }
  }

  /** Подтягивает список моделей из Ollama (/api/tags); отсутствующие заводит как disabled. */
  async sync(): Promise<{ added: string[]; total: number }> {
    const tags = await this.ollama.listTags();
    const existing = await this.prisma.model.findMany({
      select: { ollamaName: true, displayName: true },
    });
    const haveName = new Set(existing.map((e) => e.ollamaName));
    const haveDisplay = new Set(existing.map((e) => e.displayName));

    const added: string[] = [];
    for (const name of tags) {
      if (haveName.has(name)) continue;
      let displayName = safeDisplayName(name);
      if (haveDisplay.has(displayName)) displayName = `${displayName}#${name}`;
      const kind = /embed/i.test(name) ? ModelKind.EMBEDDING : ModelKind.CHAT;
      try {
        await this.prisma.model.create({
          data: { ollamaName: name, displayName, kind, isEnabled: false },
        });
        haveName.add(name);
        haveDisplay.add(displayName);
        added.push(name);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue; // гонка/коллизия — пропускаем
        }
        throw e;
      }
    }
    return { added, total: tags.length };
  }

  private mapModelError(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return new ConflictException(
          'Модель с таким ollamaName или displayName уже существует',
        );
      }
      if (e.code === 'P2025') {
        return new NotFoundException('Модель не найдена');
      }
    }
    return e;
  }
}
