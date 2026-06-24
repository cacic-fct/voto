import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnChanges,
  OnDestroy,
  PLATFORM_ID,
  SimpleChanges,
  ViewChild,
  inject,
  input,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import type { ECharts, EChartsOption } from 'echarts';
import * as echarts from 'echarts';

export type AdminResultsChartType = 'pie' | 'horizontalBar' | 'verticalBar';

export type AdminResultsChartBucket = {
  label: string;
  value: number;
};

export type AdminResultsChartConfig = {
  title: string;
  subtitle: string;
  icon: string;
  type: AdminResultsChartType;
  buckets: AdminResultsChartBucket[];
  emptyText?: string;
};

@Component({
  selector: 'app-admin-results-chart',
  imports: [MatIconModule],
  template: `
    <section class="chart-card">
      <div class="chart-card__header">
        <span class="chart-card__icon">
          <mat-icon>{{ config().icon }}</mat-icon>
        </span>
        <div class="chart-card__title-group">
          <h4 class="chart-card__title">{{ config().title }}</h4>
          <p class="chart-card__subtitle">{{ config().subtitle }}</p>
        </div>
      </div>

      @if (hasData()) {
        <div #chartHost class="chart-card__chart" role="img" [attr.aria-label]="config().title"></div>
      } @else {
        <div class="chart-card__empty">
          <mat-icon>bar_chart_off</mat-icon>
          <span>{{ config().emptyText || 'Sem dados para exibir.' }}</span>
        </div>
      }
    </section>
  `,
  styleUrl: './admin-results-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminResultsChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly config = input.required<AdminResultsChartConfig>();

  @ViewChild('chartHost')
  private chartHost?: ElementRef<HTMLDivElement>;

  private chart: ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private colorSchemeQuery: MediaQueryList | null = null;
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly handleColorSchemeChange = () => this.refreshTheme();

  ngAfterViewInit(): void {
    if (!this.isBrowser) {
      return;
    }

    this.renderChart();

    if (this.chartHost?.nativeElement && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(this.chartHost.nativeElement);
    }

    this.observeThemeChanges();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] && this.chartHost && this.isBrowser) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.colorSchemeQuery?.removeEventListener('change', this.handleColorSchemeChange);
    this.chart?.dispose();
  }

  protected hasData(): boolean {
    return this.config().buckets.length > 0;
  }

  private renderChart(): void {
    const host = this.chartHost?.nativeElement;
    if (!host || !this.hasData()) {
      return;
    }

    if (!this.chart) {
      this.chart = echarts.init(host, undefined, { renderer: 'canvas' });
    }

    this.chart.setOption(this.buildOption(), true);
  }

  private refreshTheme(): void {
    if (!this.chart) {
      return;
    }

    this.chart.setOption(this.buildOption(), true);
    this.chart.resize();
  }

  private observeThemeChanges(): void {
    if (typeof MutationObserver !== 'undefined') {
      this.themeObserver = new MutationObserver(() => this.refreshTheme());
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
      this.themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }

    this.colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.colorSchemeQuery.addEventListener('change', this.handleColorSchemeChange);
  }

  private buildOption(): EChartsOption {
    const config = this.config();
    const colors = this.readThemeColors();
    const chartData = config.buckets.map((bucket, index) => {
      const color = colors.series[index % colors.series.length];

      return {
        name: bucket.label,
        value: bucket.value,
        itemStyle: { color },
        emphasis: {
          itemStyle: {
            color,
            shadowBlur: 12,
            shadowColor: colors.shadow,
          },
        },
      };
    });

    if (config.type === 'pie') {
      return {
        color: colors.series,
        textStyle: {
          color: colors.onSurface,
          fontFamily: colors.fontFamily,
        },
        tooltip: this.tooltip(colors),
        legend: {
          bottom: 0,
          type: 'scroll',
          textStyle: { color: colors.onSurfaceVariant },
        },
        series: [
          {
            type: 'pie',
            radius: ['48%', '72%'],
            center: ['50%', '42%'],
            avoidLabelOverlap: true,
            itemStyle: {
              borderColor: colors.surface,
              borderWidth: 2,
            },
            emphasis: {
              scale: true,
              itemStyle: {
                borderColor: colors.surface,
                borderWidth: 3,
                shadowBlur: 12,
                shadowColor: colors.shadow,
              },
            },
            label: {
              color: colors.onSurface,
              formatter: '{b}',
            },
            labelLine: {
              lineStyle: { color: colors.outline },
            },
            data: chartData,
          },
        ],
      };
    }

    if (config.type === 'verticalBar') {
      return {
        color: colors.series,
        textStyle: {
          color: colors.onSurface,
          fontFamily: colors.fontFamily,
        },
        tooltip: this.tooltip(colors),
        grid: {
          left: 16,
          right: 24,
          top: 16,
          bottom: 28,
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          data: config.buckets.map((bucket) => bucket.label),
          axisLabel: {
            color: colors.onSurfaceVariant,
            interval: 0,
            rotate: config.buckets.length > 5 ? 30 : 0,
          },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: colors.outlineVariant } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: colors.onSurfaceVariant },
          splitLine: { lineStyle: { color: colors.outlineVariant } },
        },
        series: [
          {
            type: 'bar',
            data: chartData,
            barMaxWidth: 36,
            itemStyle: {
              borderRadius: [6, 6, 0, 0],
            },
            label: {
              show: true,
              position: 'top',
              color: colors.onSurfaceVariant,
            },
          },
        ],
      };
    }

    return {
      color: colors.series,
      textStyle: {
        color: colors.onSurface,
        fontFamily: colors.fontFamily,
      },
      tooltip: this.tooltip(colors),
      grid: {
        left: 8,
        right: 24,
        top: 16,
        bottom: 12,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: colors.onSurfaceVariant },
        splitLine: { lineStyle: { color: colors.outlineVariant } },
      },
      yAxis: {
        type: 'category',
        data: config.buckets.map((bucket) => bucket.label),
        inverse: true,
        axisLabel: {
          color: colors.onSurfaceVariant,
          width: 140,
          overflow: 'truncate',
        },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: colors.outlineVariant } },
      },
      series: [
        {
          type: 'bar',
          data: chartData,
          barMaxWidth: 18,
          itemStyle: {
            borderRadius: [0, 6, 6, 0],
          },
          label: {
            show: true,
            position: 'right',
            color: colors.onSurfaceVariant,
          },
        },
      ],
    };
  }

  private tooltip(colors: ChartThemeColors): EChartsOption['tooltip'] {
    return {
      trigger: 'item',
      backgroundColor: colors.surfaceContainer,
      borderColor: colors.outlineVariant,
      textStyle: {
        color: colors.onSurface,
        fontFamily: colors.fontFamily,
      },
      valueFormatter: (value) => this.formatNumber(Number(value)),
      formatter: (params) => {
        if (!this.isTooltipParam(params)) {
          return '';
        }

        return `<strong>${params.name}</strong><br/>Quantidade: ${this.formatNumber(params.value)}`;
      },
    };
  }

  private isTooltipParam(value: unknown): value is { name: string; value: number } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'name' in value &&
      'value' in value &&
      typeof value.name === 'string' &&
      typeof value.value === 'number'
    );
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: value % 1 === 0 ? 0 : 1,
    }).format(value);
  }

  private readThemeColors(): ChartThemeColors {
    const styles = getComputedStyle(document.body);
    const cssValue = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    const color = (name: string, fallback: string) => this.resolveCssColor(cssValue(name, fallback), fallback);

    return {
      fontFamily: cssValue('font-family', 'Inter Variable, sans-serif'),
      surface: color('--mat-sys-surface', '#ffffff'),
      surfaceContainer: color('--mat-sys-surface-container', '#f3f4f8'),
      onSurface: color('--mat-sys-on-surface', '#1a1b1f'),
      onSurfaceVariant: color('--mat-sys-on-surface-variant', '#44474e'),
      outline: color('--mat-sys-outline', '#74777f'),
      outlineVariant: color('--mat-sys-outline-variant', '#c4c6d0'),
      shadow: this.resolveCssColor('rgb(0 0 0 / 0.28)', 'rgba(0, 0, 0, 0.28)'),
      series: [
        color('--mat-sys-primary', '#005cbb'),
        color('--mat-sys-tertiary', '#33618d'),
        color('--mat-sys-secondary', '#565e71'),
        color('--mat-sys-error', '#ba1a1a'),
        this.resolveCssColor('#2e7d32', '#2e7d32'),
        this.resolveCssColor('#ef6c00', '#ef6c00'),
        this.resolveCssColor('#6a1b9a', '#6a1b9a'),
        this.resolveCssColor('#00838f', '#00838f'),
      ],
    };
  }

  private resolveCssColor(color: string, fallback: string): string {
    const probe = document.createElement('span');
    probe.style.color = color;

    if (!probe.style.color) {
      return fallback;
    }

    probe.style.display = 'none';
    document.body.appendChild(probe);

    const resolvedColor = getComputedStyle(probe).color;
    probe.remove();

    return resolvedColor || fallback;
  }
}

type ChartThemeColors = {
  fontFamily: string;
  surface: string;
  surfaceContainer: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  shadow: string;
  series: string[];
};
