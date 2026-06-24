import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLATFORM_ID, SimpleChange } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const echartsMock = vi.hoisted(() => {
  const setOption = vi.fn<(option: unknown, notMerge?: boolean) => void>();
  const resize = vi.fn<() => void>();
  const dispose = vi.fn<() => void>();
  const init = vi.fn(() => ({ setOption, resize, dispose }));
  return { setOption, resize, dispose, init };
});

vi.mock('echarts', () => ({ init: echartsMock.init }));

const { setOption, resize, dispose, init } = echartsMock;

import {
  AdminResultsChartComponent,
  AdminResultsChartConfig,
} from './admin-results-chart.component';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

class MutationObserverMock {
  static instances: MutationObserverMock[] = [];
  constructor(private readonly callback: MutationCallback) {
    MutationObserverMock.instances.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();

  trigger(): void {
    this.callback([], this as unknown as MutationObserver);
  }
}

describe('AdminResultsChartComponent', () => {
  let fixture: ComponentFixture<AdminResultsChartComponent>;
  let mediaListeners: EventListener[];

  const baseConfig: AdminResultsChartConfig = {
    title: 'Votos por opção',
    subtitle: 'Distribuição',
    icon: 'bar_chart',
    type: 'pie',
    buckets: [
      { label: 'Sim', value: 10 },
      { label: 'Não', value: 2.5 },
    ],
  };

  beforeEach(async () => {
    setOption.mockClear();
    resize.mockClear();
    dispose.mockClear();
    init.mockClear();
    ResizeObserverMock.instances = [];
    MutationObserverMock.instances = [];
    mediaListeners = [];

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('MutationObserver', MutationObserverMock);
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        addEventListener: vi.fn((_event: string, listener: EventListener) => mediaListeners.push(listener)),
        removeEventListener: vi.fn((_event: string, listener: EventListener) => {
          mediaListeners = mediaListeners.filter((item) => item !== listener);
        }),
      }),
    );

    await TestBed.configureTestingModule({
      imports: [AdminResultsChartComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminResultsChartComponent);
  });

  it('renders an empty state without initializing ECharts when there are no buckets', () => {
    fixture.componentRef.setInput('config', { ...baseConfig, buckets: [], emptyText: 'Sem respostas.' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Sem respostas.');
    expect(init).not.toHaveBeenCalled();
  });

  it('initializes a pie chart and formats tooltip values', () => {
    fixture.componentRef.setInput('config', baseConfig);
    fixture.detectChanges();

    expect(init).toHaveBeenCalledWith(expect.any(HTMLDivElement), undefined, { renderer: 'canvas' });
    expect(setOption).toHaveBeenCalledWith(expect.objectContaining({ series: [expect.objectContaining({ type: 'pie' })] }), true);

    const option = setOption.mock.calls[0]?.[0] as {
      tooltip: {
        valueFormatter: (value: number) => string;
        formatter: (value: unknown) => string;
      };
    };
    expect(option.tooltip.valueFormatter(2.5)).toBe('2,5');
    expect(option.tooltip.formatter({ name: 'Sim', value: 10 })).toContain('Quantidade: 10');
    expect(option.tooltip.formatter({ value: 10 })).toBe('');
  });

  it('builds vertical and horizontal bar options when config changes', () => {
    fixture.componentRef.setInput('config', {
      ...baseConfig,
      type: 'verticalBar',
      buckets: Array.from({ length: 6 }, (_, index) => ({ label: `Opção ${index + 1}`, value: index })),
    });
    fixture.detectChanges();

    const verticalOption = setOption.mock.calls.at(-1)?.[0] as {
      xAxis: { axisLabel: { rotate: number } };
      series: [{ type: string }];
    };
    expect(verticalOption.xAxis.axisLabel.rotate).toBe(30);
    expect(verticalOption.series[0].type).toBe('bar');

    fixture.componentRef.setInput('config', { ...baseConfig, type: 'horizontalBar' });
    fixture.componentInstance.ngOnChanges({
      config: new SimpleChange(baseConfig, { ...baseConfig, type: 'horizontalBar' }, false),
    });

    const horizontalOption = setOption.mock.calls.at(-1)?.[0] as {
      yAxis: { inverse: boolean };
      series: [{ label: { position: string } }];
    };
    expect(horizontalOption.yAxis.inverse).toBe(true);
    expect(horizontalOption.series[0].label.position).toBe('right');
  });

  it('refreshes and cleans up browser observers', () => {
    fixture.componentRef.setInput('config', baseConfig);
    fixture.detectChanges();

    ResizeObserverMock.instances[0]?.trigger();
    MutationObserverMock.instances[0]?.trigger();
    mediaListeners[0]?.(new Event('change'));

    expect(resize).toHaveBeenCalledTimes(3);
    expect(setOption).toHaveBeenCalledTimes(3);

    fixture.destroy();

    expect(ResizeObserverMock.instances[0]?.disconnect).toHaveBeenCalled();
    expect(MutationObserverMock.instances[0]?.disconnect).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });

  it('does nothing during server rendering', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AdminResultsChartComponent],
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminResultsChartComponent);
    fixture.componentRef.setInput('config', baseConfig);
    fixture.detectChanges();

    expect(init).not.toHaveBeenCalled();
  });

  it('returns early when refreshing before a chart exists and keeps small bar labels horizontal', () => {
    fixture.componentRef.setInput('config', { ...baseConfig, type: 'verticalBar' });
    const component = fixture.componentInstance as unknown as {
      refreshTheme(): void;
      resolveCssColor(color: string, fallback: string): string;
    };

    component.refreshTheme();
    fixture.detectChanges();

    const option = setOption.mock.calls.at(-1)?.[0] as { xAxis: { axisLabel: { rotate: number } } };
    expect(option.xAxis.axisLabel.rotate).toBe(0);
    expect(component.resolveCssColor('not-a-color', '#ffffff')).toBe('#ffffff');
  });
});
