"""
Report Generator — produces professional PDF backtest reports.
Uses reportlab for PDF generation. Falls back to HTML if not installed.
"""
import logging
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger("report_generator")


def _fmt_pct(v: float) -> str:
    return f"{v:.1f}%"

def _fmt_val(v: float, decimals: int = 2) -> str:
    return f"{v:,.{decimals}f}"

def _color_for(value: float, good_above: float = 0) -> tuple:
    """Return RGB tuple — green if above threshold, red below."""
    if value >= good_above:
        return (0.1, 0.7, 0.3)
    return (0.85, 0.2, 0.2)


def generate_html_report(
    backtest_result: dict,
    mc_result: Optional[dict],
    output_path: str,
    symbol: str,
    timeframe: str,
) -> str:
    """Generate a self-contained HTML report (always works, no deps)."""

    bt = backtest_result
    mc = mc_result or {}
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    win_rate = bt.get("win_rate", 0)
    total_return = bt.get("total_return_pct", 0)
    sharpe = bt.get("sharpe_ratio", 0)
    sortino = bt.get("sortino_ratio", 0)
    max_dd = bt.get("max_drawdown_pct", 0)
    pf = bt.get("profit_factor", 0)
    total_trades = bt.get("total_trades", 0)
    wins = bt.get("wins", 0)
    losses = bt.get("losses", 0)
    avg_rr = bt.get("avg_rr_achieved", 0)
    expectancy = bt.get("expectancy_pct", 0)
    avg_win = bt.get("avg_win_pct", 0)
    avg_loss = bt.get("avg_loss_pct", 0)
    best_trade = bt.get("best_trade_pct", 0)
    worst_trade = bt.get("worst_trade_pct", 0)
    max_cons_loss = bt.get("max_consecutive_losses", 0)

    equity_curve = bt.get("equity_curve", [])
    trade_list = bt.get("trades", [])[:20]  # show last 20

    # Build equity chart data
    eq_js = json.dumps(equity_curve)

    # Monte Carlo section
    mc_html = ""
    if mc:
        mc_html = f"""
        <div class="section">
            <h2>Monte Carlo Simulation ({mc.get('n_simulations', 1000)} runs)</h2>
            <div class="grid4">
                <div class="metric">
                    <span class="label">Median Return</span>
                    <span class="value {'pos' if mc.get('median_return_pct',0)>0 else 'neg'}">{_fmt_pct(mc.get('median_return_pct',0))}</span>
                </div>
                <div class="metric">
                    <span class="label">Prob. Profitable</span>
                    <span class="value pos">{_fmt_pct(mc.get('prob_profit_pct',0))}</span>
                </div>
                <div class="metric">
                    <span class="label">Prob. Ruin (&gt;20% DD)</span>
                    <span class="value {'neg' if mc.get('prob_ruin_pct',0)>10 else 'pos'}">{_fmt_pct(mc.get('prob_ruin_pct',0))}</span>
                </div>
                <div class="metric">
                    <span class="label">Worst Drawdown</span>
                    <span class="value neg">{_fmt_pct(mc.get('worst_max_drawdown_pct',0))}</span>
                </div>
                <div class="metric">
                    <span class="label">VaR (95%)</span>
                    <span class="value neg">{_fmt_pct(mc.get('var_95_pct',0))}</span>
                </div>
                <div class="metric">
                    <span class="label">CVaR (95%)</span>
                    <span class="value neg">{_fmt_pct(mc.get('cvar_95_pct',0))}</span>
                </div>
                <div class="metric">
                    <span class="label">Median Sharpe</span>
                    <span class="value {'pos' if mc.get('median_sharpe',0)>1 else 'neutral'}">{mc.get('median_sharpe',0):.2f}</span>
                </div>
                <div class="metric">
                    <span class="label">Best Return</span>
                    <span class="value pos">{_fmt_pct(mc.get('best_return_pct',0))}</span>
                </div>
            </div>
        </div>
        """

    # Trade rows
    trade_rows = ""
    for t in trade_list:
        ret = t.get("return_pct", 0)
        color = "#22c55e" if ret > 0 else "#ef4444"
        trade_rows += f"""
        <tr>
            <td>{t.get('symbol','')}</td>
            <td>{t.get('direction','')}</td>
            <td>{t.get('entry_price','')}</td>
            <td>{t.get('exit_price','')}</td>
            <td style="color:{color}">{_fmt_pct(ret)}</td>
            <td>{t.get('rr_achieved','')}</td>
            <td>{t.get('ai_score','')}</td>
            <td>{t.get('exit_reason','')}</td>
        </tr>
        """

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>VECTOR Intelligence — Backtest Report</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: 'Segoe UI', sans-serif; background: #0a0a0a; color: #e4e4e7; padding: 40px; }}
  h1 {{ font-size: 28px; font-weight: 700; color: #fff; margin-bottom: 4px; }}
  h2 {{ font-size: 14px; font-weight: 600; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px; }}
  .subtitle {{ color: #71717a; font-size: 13px; margin-bottom: 40px; }}
  .section {{ background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 24px; margin-bottom: 24px; }}
  .grid4 {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }}
  .metric {{ display: flex; flex-direction: column; gap: 4px; }}
  .label {{ font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; }}
  .value {{ font-size: 22px; font-weight: 700; }}
  .pos {{ color: #22c55e; }}
  .neg {{ color: #ef4444; }}
  .neutral {{ color: #a1a1aa; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  th {{ text-align: left; color: #71717a; font-size: 11px; text-transform: uppercase; padding: 8px 12px; border-bottom: 1px solid #27272a; }}
  td {{ padding: 8px 12px; border-bottom: 1px solid #1c1c1f; }}
  tr:hover td {{ background: #1c1c1f; }}
  canvas {{ width: 100% !important; max-height: 200px; }}
  .badge {{ display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }}
  .badge-green {{ background: #14532d; color: #22c55e; }}
  .badge-red {{ background: #450a0a; color: #ef4444; }}
  .badge-yellow {{ background: #422006; color: #f59e0b; }}
</style>
</head>
<body>
<h1>VECTOR Intelligence — Backtest Report</h1>
<p class="subtitle">{symbol} · {timeframe} · Generated {now}</p>

<div class="section">
  <h2>Performance Summary</h2>
  <div class="grid4">
    <div class="metric">
      <span class="label">Total Return</span>
      <span class="value {'pos' if total_return>0 else 'neg'}">{_fmt_pct(total_return)}</span>
    </div>
    <div class="metric">
      <span class="label">Win Rate</span>
      <span class="value {'pos' if win_rate>50 else 'neg'}">{_fmt_pct(win_rate)}</span>
    </div>
    <div class="metric">
      <span class="label">Sharpe Ratio</span>
      <span class="value {'pos' if sharpe>1 else 'neg'}">{sharpe:.2f}</span>
    </div>
    <div class="metric">
      <span class="label">Sortino Ratio</span>
      <span class="value {'pos' if sortino>1 else 'neg'}">{sortino:.2f}</span>
    </div>
    <div class="metric">
      <span class="label">Max Drawdown</span>
      <span class="value neg">{_fmt_pct(max_dd)}</span>
    </div>
    <div class="metric">
      <span class="label">Profit Factor</span>
      <span class="value {'pos' if pf>1.5 else 'neg'}">{pf:.2f}</span>
    </div>
    <div class="metric">
      <span class="label">Expectancy</span>
      <span class="value {'pos' if expectancy>0 else 'neg'}">{_fmt_pct(expectancy)}</span>
    </div>
    <div class="metric">
      <span class="label">Avg R:R Achieved</span>
      <span class="value neutral">{avg_rr:.2f}</span>
    </div>
  </div>
</div>

<div class="section">
  <h2>Trade Statistics</h2>
  <div class="grid4">
    <div class="metric"><span class="label">Total Trades</span><span class="value neutral">{total_trades}</span></div>
    <div class="metric"><span class="label">Wins</span><span class="value pos">{wins}</span></div>
    <div class="metric"><span class="label">Losses</span><span class="value neg">{losses}</span></div>
    <div class="metric"><span class="label">Max Consec. Losses</span><span class="value neg">{max_cons_loss}</span></div>
    <div class="metric"><span class="label">Avg Win</span><span class="value pos">{_fmt_pct(avg_win)}</span></div>
    <div class="metric"><span class="label">Avg Loss</span><span class="value neg">{_fmt_pct(avg_loss)}</span></div>
    <div class="metric"><span class="label">Best Trade</span><span class="value pos">{_fmt_pct(best_trade)}</span></div>
    <div class="metric"><span class="label">Worst Trade</span><span class="value neg">{_fmt_pct(worst_trade)}</span></div>
  </div>
</div>

<div class="section">
  <h2>Equity Curve</h2>
  <canvas id="eqChart"></canvas>
</div>

{mc_html}

<div class="section">
  <h2>Trade Log (Last 20)</h2>
  <table>
    <thead>
      <tr><th>Symbol</th><th>Dir</th><th>Entry</th><th>Exit</th><th>Return</th><th>R:R</th><th>AI Score</th><th>Reason</th></tr>
    </thead>
    <tbody>{trade_rows}</tbody>
  </table>
</div>

<script>
const eqData = {eq_js};
if (eqData && eqData.length > 1) {{
  const canvas = document.getElementById('eqChart');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement.offsetWidth;
  canvas.height = 200;
  const w = canvas.width, h = canvas.height;
  const min = Math.min(...eqData), max = Math.max(...eqData);
  const range = max - min || 1;
  ctx.beginPath();
  eqData.forEach((v, i) => {{
    const x = (i / (eqData.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 20) - 10;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }});
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Fill under curve
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = 'rgba(34,197,94,0.08)';
  ctx.fill();
}}
</script>
</body>
</html>"""

    Path(output_path).write_text(html, encoding="utf-8")
    logger.info(f"HTML report saved: {output_path}")
    return output_path


def generate_pdf_report(
    backtest_result: dict,
    mc_result: Optional[dict],
    output_dir: str,
    symbol: str,
    timeframe: str,
) -> str:
    """
    Generate PDF report. Uses reportlab if available, otherwise HTML.
    Returns path to generated file.
    """
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Try HTML first (always works)
    html_path = str(out_dir / f"backtest_{symbol}_{timeframe}_{ts}.html")
    generate_html_report(backtest_result, mc_result, html_path, symbol, timeframe)

    # Try PDF via reportlab
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

        pdf_path = str(out_dir / f"backtest_{symbol}_{timeframe}_{ts}.pdf")
        doc = SimpleDocTemplate(pdf_path, pagesize=A4,
                                topMargin=2*cm, bottomMargin=2*cm,
                                leftMargin=2*cm, rightMargin=2*cm)
        styles = getSampleStyleSheet()
        black_bg = colors.HexColor("#0a0a0a")
        green = colors.HexColor("#22c55e")
        red = colors.HexColor("#ef4444")
        gray = colors.HexColor("#71717a")

        story = []
        title_style = ParagraphStyle("title", fontSize=20, textColor=colors.white,
                                     fontName="Helvetica-Bold", spaceAfter=6)
        sub_style = ParagraphStyle("sub", fontSize=10, textColor=gray,
                                   fontName="Helvetica", spaceAfter=20)
        h2_style = ParagraphStyle("h2", fontSize=12, textColor=gray,
                                  fontName="Helvetica-Bold", spaceAfter=10)

        story.append(Paragraph("VECTOR Intelligence — Backtest Report", title_style))
        story.append(Paragraph(f"{symbol} · {timeframe} · {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", sub_style))

        bt = backtest_result
        summary_data = [
            ["Metric", "Value", "Metric", "Value"],
            ["Total Return", _fmt_pct(bt.get("total_return_pct", 0)),
             "Win Rate", _fmt_pct(bt.get("win_rate", 0))],
            ["Sharpe Ratio", f"{bt.get('sharpe_ratio', 0):.2f}",
             "Sortino Ratio", f"{bt.get('sortino_ratio', 0):.2f}"],
            ["Max Drawdown", _fmt_pct(bt.get("max_drawdown_pct", 0)),
             "Profit Factor", f"{bt.get('profit_factor', 0):.2f}"],
            ["Total Trades", str(bt.get("total_trades", 0)),
             "Expectancy", _fmt_pct(bt.get("expectancy_pct", 0))],
            ["Avg Win", _fmt_pct(bt.get("avg_win_pct", 0)),
             "Avg Loss", _fmt_pct(bt.get("avg_loss_pct", 0))],
        ]

        tbl = Table(summary_data, colWidths=[4*cm, 4*cm, 4*cm, 4*cm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#27272a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), gray),
            ("TEXTCOLOR", (0, 1), (-1, -1), colors.white),
            ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#18181b")),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [colors.HexColor("#18181b"), colors.HexColor("#1c1c1f")]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#27272a")),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(Paragraph("Performance Summary", h2_style))
        story.append(tbl)
        story.append(Spacer(1, 0.5*cm))

        if mc_result:
            story.append(Paragraph(f"Monte Carlo ({mc_result.get('n_simulations', 1000)} simulations)", h2_style))
            mc_data = [
                ["Metric", "Value", "Metric", "Value"],
                ["Median Return", _fmt_pct(mc_result.get("median_return_pct", 0)),
                 "Prob. Profitable", _fmt_pct(mc_result.get("prob_profit_pct", 0))],
                ["Prob. Ruin", _fmt_pct(mc_result.get("prob_ruin_pct", 0)),
                 "Worst DD", _fmt_pct(mc_result.get("worst_max_drawdown_pct", 0))],
                ["VaR 95%", _fmt_pct(mc_result.get("var_95_pct", 0)),
                 "CVaR 95%", _fmt_pct(mc_result.get("cvar_95_pct", 0))],
                ["Median Sharpe", f"{mc_result.get('median_sharpe', 0):.2f}",
                 "Best Return", _fmt_pct(mc_result.get("best_return_pct", 0))],
            ]
            mc_tbl = Table(mc_data, colWidths=[4*cm, 4*cm, 4*cm, 4*cm])
            mc_tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#27272a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), gray),
                ("TEXTCOLOR", (0, 1), (-1, -1), colors.white),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#18181b")),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1),
                 [colors.HexColor("#18181b"), colors.HexColor("#1c1c1f")]),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#27272a")),
                ("PADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(mc_tbl)

        doc.build(story)
        logger.info(f"PDF report saved: {pdf_path}")
        return pdf_path

    except ImportError:
        logger.warning("reportlab not installed — HTML report only")
        return html_path
    except Exception as e:
        logger.error(f"PDF generation failed: {e} — HTML report saved")
        return html_path
