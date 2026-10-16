'use client';

import { useEffect, useState } from 'react';

import {
  getWeeklySignups,
  getReferralSources,
  getDailySignups,
  getProSubscribers,
  type WeeklySignup,
  type ReferralSource,
  type DailySignup,
  type ProSubscriber,
} from '@/actions/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

export function AdminDashboard() {
  const [weeklySignups, setWeeklySignups] = useState<WeeklySignup[]>([]);
  const [referralSources, setReferralSources] = useState<ReferralSource[]>([]);
  const [dailySignups, setDailySignups] = useState<DailySignup[]>([]);
  const [proSubscribers, setProSubscribers] = useState<ProSubscriber[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [weekly, referrals, daily, pros] = await Promise.all([
          getWeeklySignups(),
          getReferralSources(),
          getDailySignups(),
          getProSubscribers(),
        ]);
        setWeeklySignups(weekly);
        setReferralSources(referrals);
        setDailySignups(daily);
        setProSubscribers(pros);
      } catch (err) {
        console.error('Failed to load admin data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto space-y-6 p-6">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-48 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Prepare data for line charts
  const weeklyData = [...weeklySignups]
    .sort((a, b) => new Date(a.signup_week).getTime() - new Date(b.signup_week).getTime())
    .map((w) => ({
      label: formatWeek(w.signup_week),
      value: w.new_signups,
    }));

  const referralData = referralSources.slice(0, 10).map((r) => ({
    label: r.referral_source ?? 'unknown',
    value: r.user_count,
  }));

  const dailyData = dailySignups.map((d) => ({
    label: d.signup_date,
    value: d.new_signups,
  }));

  return (
    <div className="container mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Weekly Signups Line Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Weekly New Signups (Last 90 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {weeklyData.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data available</p>
            ) : (
              <LineChart
                data={weeklyData}
                color="#3b82f6"
                gradientId="weeklyGradient"
                valueLabel="signups"
              />
            )}
          </CardContent>
        </Card>

        {/* Referral Sources Vertical Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle>User Count by Referral Source</CardTitle>
          </CardHeader>
          <CardContent>
            {referralData.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data available</p>
            ) : (
              <VerticalBarChart data={referralData} color="#22c55e" valueLabel="users" />
            )}
          </CardContent>
        </Card>

        {/* Daily Signups Line Chart (All Time) */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              Daily Signups (All Time: {dailyData.reduce((sum, d) => sum + d.value, 0)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dailyData.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data available</p>
            ) : (
              <LineChart
                data={dailyData}
                color="#8b5cf6"
                gradientId="dailyGradient"
                valueLabel="signups"
                showEveryNthLabel={Math.max(1, Math.floor(dailyData.length / 12))}
                fullWidth
              />
            )}
          </CardContent>
        </Card>

        {/* Pro Subscribers Table */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Pro Subscribers</CardTitle>
          </CardHeader>
          <CardContent>
            {proSubscribers.length === 0 ? (
              <p className="text-muted-foreground text-sm">No pro subscribers</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Pro</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period End</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proSubscribers.map((sub) => (
                    <TableRow key={sub.user_id}>
                      <TableCell className="font-mono text-sm">{sub.email}</TableCell>
                      <TableCell>{sub.is_pro ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{sub.subscription_status ?? '-'}</TableCell>
                      <TableCell>
                        {sub.current_period_end ? formatDate(sub.current_period_end) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic Line Chart Component
// ─────────────────────────────────────────────────────────────────────────────
interface DataPoint {
  label: string;
  value: number;
}

interface LineChartProps {
  data: DataPoint[];
  color: string;
  gradientId: string;
  valueLabel: string;
  showEveryNthLabel?: number;
  fullWidth?: boolean;
}

function LineChart({
  data,
  color,
  gradientId,
  valueLabel,
  showEveryNthLabel = 1,
  fullWidth = false,
}: LineChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const width = fullWidth ? 1200 : 400;
  const height = fullWidth ? 220 : 180;
  const paddingX = 40;
  const paddingY = 20;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  const points = data.map((d, i) => {
    const x = paddingX + (i / (data.length - 1 || 1)) * chartWidth;
    const y = paddingY + chartHeight - (d.value / maxValue) * chartHeight;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Area fill path
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${paddingY + chartHeight} L ${paddingX} ${paddingY + chartHeight} Z`
      : '';

  // Y-axis labels
  const yLabels = [0, Math.round(maxValue / 2), maxValue];

  // Lighter color for hover
  const hoverColor = adjustColorBrightness(color, 20);

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={fullWidth ? 'h-64 w-full' : 'h-44 w-full min-w-[300px]'}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Gradient definition */}
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {yLabels.map((val) => {
          const y = paddingY + chartHeight - (val / maxValue) * chartHeight;
          return (
            <g key={val}>
              <line
                x1={paddingX}
                x2={width - paddingX}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeDasharray="4"
              />
              <text
                x={paddingX - 6}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} opacity={0.3} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

        {/* Data points (interactive) */}
        {points.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hoveredIndex === i ? 5 : 3}
              fill={hoveredIndex === i ? hoverColor : color}
              className="cursor-pointer transition-all"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          </g>
        ))}

        {/* X-axis labels */}
        {points
          .filter((_, i) => i % showEveryNthLabel === 0 || i === points.length - 1)
          .map((p, idx) => (
            <text
              key={`label-${idx}`}
              x={p.x}
              y={height - 4}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px]"
            >
              {formatLabel(p.label)}
            </text>
          ))}
      </svg>

      {/* Tooltip */}
      {hoveredIndex !== null && points[hoveredIndex] && (
        <div
          className="pointer-events-none absolute z-10 rounded bg-black px-2 py-1 text-xs text-white shadow-lg"
          style={{
            left: `${(points[hoveredIndex].x / width) * 100}%`,
            top: '10%',
            transform: 'translateX(-50%)',
          }}
        >
          {formatLabel(points[hoveredIndex].label)}: {points[hoveredIndex].value} {valueLabel}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertical Bar Chart Component
// ─────────────────────────────────────────────────────────────────────────────
interface VerticalBarChartProps {
  data: DataPoint[];
  color: string;
  valueLabel: string;
}

function VerticalBarChart({ data, color, valueLabel }: VerticalBarChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const width = 400;
  const height = 180;
  const paddingX = 35;
  const paddingY = 20;
  const paddingBottom = 40;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY - paddingBottom;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.min(40, (chartWidth / data.length) * 0.7);
  const gap = (chartWidth - barWidth * data.length) / (data.length + 1);

  const bars = data.map((d, i) => {
    const x = paddingX + gap + i * (barWidth + gap);
    const barHeight = (d.value / maxValue) * chartHeight;
    const y = paddingY + chartHeight - barHeight;
    return { x, y, barHeight, ...d };
  });

  // Y-axis labels
  const yLabels = [0, Math.round(maxValue / 2), maxValue];

  const hoverColor = adjustColorBrightness(color, 20);

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full min-w-[300px]"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {yLabels.map((val) => {
          const y = paddingY + chartHeight - (val / maxValue) * chartHeight;
          return (
            <g key={val}>
              <line
                x1={paddingX}
                x2={width - paddingX}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeDasharray="4"
              />
              <text
                x={paddingX - 6}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {bars.map((bar, i) => (
          <g key={`${bar.label}-${i}`}>
            <rect
              x={bar.x}
              y={bar.y}
              width={barWidth}
              height={bar.barHeight}
              fill={hoveredIndex === i ? hoverColor : color}
              rx={3}
              className="cursor-pointer transition-all"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
            {/* X-axis label */}
            <text
              x={bar.x + barWidth / 2}
              y={height - paddingBottom + 14}
              textAnchor="middle"
              className="fill-muted-foreground text-[8px]"
              transform={`rotate(-45, ${bar.x + barWidth / 2}, ${height - paddingBottom + 14})`}
            >
              {bar.label.length > 10 ? bar.label.slice(0, 8) + '…' : bar.label}
            </text>
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredIndex !== null && bars[hoveredIndex] && (
        <div
          className="pointer-events-none absolute z-10 rounded bg-black px-2 py-1 text-xs text-white shadow-lg"
          style={{
            left: `${((bars[hoveredIndex].x + barWidth / 2) / width) * 100}%`,
            top: '5%',
            transform: 'translateX(-50%)',
          }}
        >
          {bars[hoveredIndex].label}: {bars[hoveredIndex].value} {valueLabel}
        </div>
      )}
    </div>
  );
}

function formatWeek(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function formatLabel(label: string): string {
  // Try to parse as date, otherwise return as-is
  const d = new Date(label);
  if (!isNaN(d.getTime()) && label.includes('-')) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  // Truncate long labels
  return label.length > 12 ? label.slice(0, 10) + '…' : label;
}

function adjustColorBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, (num >> 16) + amt);
  const G = Math.min(255, ((num >> 8) & 0x00ff) + amt);
  const B = Math.min(255, (num & 0x0000ff) + amt);
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}
