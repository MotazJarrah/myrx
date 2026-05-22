"""Generates the Samsung Health Data SDK partner-application data-flow PDF.

Output: docs/integrations/samsung-data-flow.pdf (single-page US Letter).
"""

import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
)


OUT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "docs", "integrations",
                 "samsung-data-flow.pdf")
)
os.makedirs(os.path.dirname(OUT), exist_ok=True)


def build():
    doc = SimpleDocTemplate(
        OUT,
        pagesize=LETTER,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        title="MyRX x Samsung Health Data SDK - Data Flow",
        author="Northern Princess LLC",
    )

    base = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "TitleX", parent=base["Title"],
        fontName="Helvetica-Bold", fontSize=18, leading=22,
        alignment=TA_CENTER, spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "SubtitleX", parent=base["Normal"],
        fontName="Helvetica", fontSize=10, leading=13,
        textColor=colors.HexColor("#666666"),
        alignment=TA_CENTER, spaceAfter=18,
    )
    h2 = ParagraphStyle(
        "H2X", parent=base["Heading2"],
        fontName="Helvetica-Bold", fontSize=12, leading=15,
        textColor=colors.HexColor("#1a1a1a"),
        spaceBefore=14, spaceAfter=8,
    )
    body = ParagraphStyle(
        "BodyX", parent=base["Normal"],
        fontName="Helvetica", fontSize=10, leading=14,
        alignment=TA_LEFT, spaceAfter=4,
    )
    mono = ParagraphStyle(
        "MonoX", parent=base["Normal"],
        fontName="Courier", fontSize=9, leading=13,
        alignment=TA_LEFT,
    )
    note = ParagraphStyle(
        "NoteX", parent=base["Normal"],
        fontName="Helvetica-Oblique", fontSize=9, leading=12,
        textColor=colors.HexColor("#444444"),
    )

    story = []

    story.append(Paragraph("MyRX &times; Samsung Health Data SDK &mdash; Data Flow", title_style))
    story.append(Paragraph(
        "Northern Princess LLC &middot; myrxfit.com &middot; May 18, 2026",
        subtitle_style,
    ))

    # --- Data flow ----------------------------------------------------------
    story.append(Paragraph("Data flow", h2))

    flow_rows = [
        ["1.", "Galaxy Watch", "Captures heart-rate, workout, and sleep data on-device."],
        ["", "&darr;  Bluetooth Low Energy (paired)", ""],
        ["2.", "Samsung Health app (Galaxy phone)", "Stores the user's health data locally and syncs to the user's Samsung account."],
        ["", "&darr;  Samsung Health Data SDK (Android, read-only)", ""],
        ["3.", "MyRX Android app  (package: com.myrx.app)", "Requests read-only access to the seven data types listed below; user grants consent via Samsung Health's native permission UI."],
        ["", "&darr;  HTTPS over TLS 1.3, authenticated session", ""],
        ["4.", "Supabase Postgres  (per-user rows, RLS-scoped, AES-256 at rest)", "Caches the latest fetched values keyed to the authenticated MyRX user; deleted on user disconnect."],
        ["", "&darr;  Server-side compute", ""],
        ["5.", "MyRX cardio coaching engine", "Generates personalized prescriptions in the Endurance, Threshold, and VO2 Max zones using Daniels' formulas and the user's actual best paces / HR."],
    ]
    tbl = Table(
        [[Paragraph(c, body if i % 2 == 0 else note) for c in r] for i, r in enumerate(flow_rows)],
        colWidths=[0.3 * inch, 2.6 * inch, 4.1 * inch],
        hAlign="LEFT",
    )
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(KeepTogether(tbl))

    # --- Data types read -----------------------------------------------------
    story.append(Paragraph("Data types read (read-only, all from Samsung Health on the paired phone)", h2))

    data_rows = [
        ["Heart rate", "Anchors Endurance / Threshold / VO2 Max cardio zones; confirms target intensity during workouts."],
        ["Exercise with location", "Workout type, duration, distance, intensity profile, GPS-derived pace and elevation. Core input for cardio training-history analysis."],
        ["Sleep", "Sleep duration feeds the recovery score that gates harder training days. Used as a signal only; MyRX does not prescribe sleep itself."],
        ["Steps", "Daily activity baseline used to differentiate sedentary days from active-rest days when scheduling sessions."],
        ["Activity summary", "Aggregated daily activity used in recovery and training-load balance calculations."],
        ["Body composition", "Weight and body-fat percentage used to compute lean body mass, BMR, and bodyweight-relative strength prescriptions (e.g., assisted pull-up % of bodyweight)."],
        ["User profile", "Height, weight, age, sex - required to compute personalized targets such as max HR, projected paces, and energy expenditure."],
    ]
    dt = Table(
        [[Paragraph("<b>%s</b>" % name, body), Paragraph(purpose, body)] for name, purpose in data_rows],
        colWidths=[1.6 * inch, 5.4 * inch],
        hAlign="LEFT",
    )
    dt.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#dddddd")),
    ]))
    story.append(dt)

    # --- Data types written -------------------------------------------------
    story.append(Paragraph("Data types written", h2))
    story.append(Paragraph(
        "<b>None.</b> MyRX v1 does not write any data to Samsung Health. The integration is strictly read-only.",
        body,
    ))

    # --- Privacy commitments ------------------------------------------------
    story.append(Paragraph("Privacy commitments", h2))
    story.append(Paragraph(
        "All data fetched from Samsung Health is (a) read-only and read on demand &mdash; not bulk-mirrored; "
        "(b) encrypted at rest in Supabase Postgres with AES-256 and scoped per user via Row-Level Security; "
        "(c) never sold, never shared with third parties, never used for advertising; "
        "(d) deleted from MyRX's backend the moment the user taps Disconnect in Settings &rarr; Connect, at which "
        "point MyRX also revokes its Samsung Health SDK access via the de-registration endpoint.",
        body,
    ))

    doc.build(story)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
