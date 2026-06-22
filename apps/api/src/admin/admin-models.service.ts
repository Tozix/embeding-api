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

  /** Рантайм-статус: какие зарегистрированные модели сейчас в памяти (Ollama /api/ps). */
  async runtime(): Promise<
    (AdminModelDto & {
      loaded: boolean;
      sizeBytes: number;
      expiresAt: string | null;
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
