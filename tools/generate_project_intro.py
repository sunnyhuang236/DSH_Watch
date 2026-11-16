#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

NAVY = "123B4A"
TEAL = "1F8A70"
ORANGE = "D97757"
LIGHT = "F4F7F6"
MID = "E6EFEC"
GRAY = "5D6B70"
WHITE = "FFFFFF"


def _font(size, bold=False):
    names = [
        "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
    ]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def make_architecture():
    W, H = 1800, 860
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)
    draw.text((60, 35), "DSH Watch 系统架构", font=_font(44, True), fill="#" + NAVY)
    draw.text((62, 95), "本机运行 · 零服务器 · 手机通过 PWA 接入", font=_font(22), fill="#" + GRAY)
    draw.line((60, 140, 1740, 140), fill="#" + MID, width=2)

    boxes = [
        (60, 190, 430, 280, "DSH Desktop / Agent", ["长任务执行", "工具调用", "审批 / 问答事件"]),
        (540, 190, 430, 280, "dsh-watch 插件", ["事件订阅 · 状态机", "SQLite 任务索引", "只读 /v1 API :7317"]),
        (1020, 190, 350, 280, "Local Gateway", ["设备 token 鉴权", "/v1 反向代理", "PWA 托管 / Web Push :8787"]),
        (1450, 190, 300, 280, "iPhone PWA", ["任务列表 / 详情", "审批 / 问答卡片", "轨迹 / 费用 / 子代理"]),
    ]
    for x, y, w, h, title, lines in boxes:
        draw.rounded_rectangle((x, y, x + w, y + h), radius=18, fill="#" + LIGHT, outline="#" + TEAL, width=3)
        draw.rectangle((x, y, x + w, y + 58), fill="#" + TEAL)
        draw.text((x + 22, y + 14), title, font=_font(26, True), fill="white")
        ty = y + 82
        for line in lines:
            draw.text((x + 22, ty), "· " + line, font=_font(20), fill="#" + NAVY)
            ty += 42
    # arrows
    def arrow(x1, y1, x2, y2, color=TEAL, width=4):
        draw.line((x1, y1, x2, y2), fill="#" + color, width=width)
        import math
        angle = math.atan2(y2 - y1, x2 - x1)
        size = 16
        p1 = (x2 - size * math.cos(angle - 0.5), y2 - size * math.sin(angle - 0.5))
        p2 = (x2 - size * math.cos(angle + 0.5), y2 - size * math.sin(angle + 0.5))
        draw.polygon([(x2, y2), p1, p2], fill="#" + color)
    arrow(490, 330, 540, 330)
    draw.text((462, 300), "事件 / 审批", font=_font(17), fill="#" + GRAY)
    arrow(970, 330, 1020, 330)
    draw.text((965, 300), "只读 API", font=_font(17), fill="#" + GRAY)
    arrow(1370, 330, 1450, 330)
    draw.text((1375, 300), "PWA / Push", font=_font(17), fill="#" + GRAY)
    # cloud layer
    draw.rounded_rectangle((1020, 570, 1370, 690), radius=16, fill="#FFF8F0", outline="#" + ORANGE, width=3)
    draw.text((1045, 585), "cloudflared quick tunnel（可选）", font=_font(22, True), fill="#" + ORANGE)
    draw.text((1045, 625), "HTTPS 公网地址 · 随机域名 · 每次重启会变", font=_font(17), fill="#" + GRAY)
    arrow(1195, 470, 1195, 570, color=ORANGE)
    draw.text((1210, 495), "HTTPS", font=_font(17), fill="#" + ORANGE)
    arrow(1370, 630, 1560, 470, color=ORANGE)
    draw.text((1425, 595), "手机访问", font=_font(17), fill="#" + ORANGE)
    draw.line((60, 785, 1740, 785), fill="#" + MID, width=2)
    draw.text((60, 805), "数据只在电脑本机产生和保存；手机端只通过设备 token 访问 /v1 接口。",
              font=_font(18), fill="#" + GRAY)
    img.save(ASSETS / "architecture.png")


def set_run_font(run, size=10.5, bold=False, color=NAVY, font="Microsoft YaHei"):
    run.bold = bold
    run.font.name = font
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.rFonts
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), font)


def shade(cell, color):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), color)
    tc_pr.append(shd)


def set_cell_text(cell, text, size=10, bold=False, color=NAVY, align=WD_ALIGN_PARAGRAPH.LEFT):
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = align
    p.paragraph_format.space_after = Pt(2)
    set_run_font(p.add_run(str(text)), size=size, bold=bold, color=color)


def add_para(doc, text="", size=10.5, bold=False, color=NAVY, after=6, before=0, align=WD_ALIGN_PARAGRAPH.JUSTIFY):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.space_before = Pt(before)
    p.paragraph_format.line_spacing = 1.35
    set_run_font(p.add_run(text), size=size, bold=bold, color=color)
    return p


def add_bullet(doc, text, size=10.5):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.3
    set_run_font(p.add_run(text), size=size, color=NAVY)


def add_chapter(doc, number, title):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(4)
    set_run_font(p.add_run(f"{number}  {title}"), size=19, bold=True, color=TEAL)
    # thin rule under heading
    p_pr = p._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), TEAL)
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


def add_caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(8)
    set_run_font(p.add_run(text), size=8.5, color=GRAY)


def make_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        shade(cell, NAVY)
        set_cell_text(cell, h, size=9.5, bold=True, color=WHITE)
    for row in rows:
        cells = table.add_row().cells
        for i, value in enumerate(row):
            set_cell_text(cells[i], value, size=9.2)
    if widths:
        for row in table.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    return table


def make_doc():
    make_architecture()
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(1.8)
    section.left_margin = Cm(2.2)
    section.right_margin = Cm(2.0)
    normal = doc.styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal.font.size = Pt(10.5)
    normal._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.paragraph_format.line_spacing = 1.35
    for name, size, color in [("Heading 1", 19, TEAL), ("Heading 2", 14, NAVY)]:
        st = doc.styles[name]
        st.font.name = "Microsoft YaHei"
        st.font.size = Pt(size)
        st.font.color.rgb = RGBColor.from_string(color)
    doc.core_properties.title = "DSH Watch 移动盯梢器 · 项目介绍"
    doc.core_properties.subject = "DSH long-running task mobile companion"
    doc.core_properties.author = "DSH Watch 项目组"

    # footer
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(footer.add_run("DSH Watch · 项目介绍"), size=8, color=GRAY)

    # cover
    for _ in range(2):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run("DSH WATCH"), size=40, bold=True, color=NAVY)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run("移动盯梢器"), size=32, bold=True, color=TEAL)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(8)
    set_run_font(p.add_run("让电脑上的长任务，在手机上随时有回应"), size=16, color=GRAY)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(24)
    p.add_run().add_picture(str(ROOT / "apps" / "web" / "icons" / "icon-512.png"), width=Cm(3.0))
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(24)
    set_run_font(p.add_run("项目介绍 · 2026-11-16"), size=11, color=GRAY)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    set_run_font(p.add_run("零服务器 · 零推送费用 · 手机 PWA 直达"), size=10.5, color=TEAL)
    doc.add_page_break()

    # 01 one-page overview
    add_chapter(doc, "01", "一页看懂 DSH Watch")
    add_para(doc, "DSH Watch 是运行在电脑上的 DSH（DeepSeek Harness）长任务移动伴侣。它把 DSH 的任务状态、审批请求和提问，通过本机插件与局域网网关同步到手机 PWA；人不在电脑前，也能知道任务是否需要介入。", size=11)
    add_para(doc, "核心价值不是“再做一个聊天客户端”，而是把“长任务运行中，人被迫守在电脑前”这件事拆掉：任务继续跑，手机负责提醒、审批和回答。", size=10.5)
    make_table(doc,
        ["关键指标", "当前结果"],
        [
            ["测试", "71 / 71 通过"],
            ["M2 手机 Web Push", "V06 真机 20 / 20 到达（100%）"],
            ["M4 边界测试", "手机拒绝、桌面先允许→conflict、插件重启 expired 全部通过"],
            ["服务器成本", "0 元；全部本机运行，公网入口使用可选 quick tunnel"],
            ["核心终端", "iPhone 主屏幕 PWA；M3 SwiftUI 作为可选展示版"],
        ], widths=[4.5, 12.0])
    add_para(doc, "一句话总结：电脑上的 DSH 不需要被“搬到手机上”；手机只需要在正确的时间收到正确的状态，并能完成审批/回答这一小步。", size=10.5, color=TEAL, bold=True, before=8)
    add_para(doc, "典型使用场景", size=13, bold=True, color=TEAL, before=12)
    for t in [
        "启动构建/测试后离开电脑，任务完成或失败时手机通知；",
        "长任务正在等待审批时，人在会议/路上，手机直接允许或拒绝；",
        "多子代理任务运行时，手机查看子代理数量、父子关系和最近一轮轨迹；",
        "需要把 DSH 当前状态快速展示给别人时，手机详情页就是一张现成的状态卡。",
    ]:
        add_bullet(doc, t)
    add_para(doc, "项目边界", size=13, bold=True, color=TEAL, before=10)
    add_para(doc, "不重做 DSH 的聊天界面，不替代桌面端，不把 session 日志上传云端；它只补上“人离开电脑后”的提醒、审批和回答。", size=10.5)
    doc.add_page_break()

    # 02 background
    add_chapter(doc, "02", "为什么需要它")
    add_para(doc, "DSH 的长任务经常持续几分钟到几十分钟：构建、测试、批量修改、长时间命令。任务跑起来之后，人会离开电脑；一旦出现审批或提问，任务就卡住，直到有人回到电脑前。", size=10.5)
    for t in [
        "等待焦虑：不知道任务是在运行、失败，还是停在某个审批上；",
        "响应延迟：审批/提问出现时人不在电脑前，长任务被迫中断；",
        "通知噪音：普通聊天推送只告诉你“有新消息”，不告诉你“是否需要你介入”；",
        "部署负担：很多方案要服务器、APNs、账号和证书，个人项目很难零成本落地。",
    ]:
        add_bullet(doc, t)
    add_para(doc, "DSH Watch 的设计目标：零服务器、零推送费用、手机端不安装原生 App 也能用；同时把“是否需要人介入”作为第一等状态。", size=10.5, color=TEAL, bold=True, before=8)
    doc.add_page_break()

    # 03 product
    add_chapter(doc, "03", "产品是什么")
    add_para(doc, "产品由三个部分组成：DSH 插件负责“看懂任务”，本机网关负责“安全地送到手机”，PWA 负责“让人一眼看懂并处理”。", size=10.5)
    make_table(doc,
        ["模块", "职责", "用户感知"],
        [
            ["dsh-watch 插件", "订阅 DSH 事件，归一化为任务/步骤/审批/问答；SQLite 索引；只读 /v1 API", "任务列表准确、详情完整、状态及时"],
            ["Local Gateway", "配对、设备 token、/v1 反向代理、PWA 托管、Web Push", "手机扫码/输码即可连上电脑"],
            ["PWA", "任务列表/详情、审批卡、问答卡、轨迹、费用、子代理、提醒记录", "主屏幕图标，锁屏通知，点开就能处理"],
        ], widths=[3.2, 8.0, 5.3])
    add_para(doc, "核心功能", size=13, bold=True, color=TEAL, before=10)
    for t in [
        "任务盯梢：运行中 / 等待审批 / 等待回答 / 完成 / 失败，一眼看清；",
        "手机审批：允许一次、拒绝；桌面先处理时手机收到 409 conflict；插件重启后旧 pending 返回 410 expired；",
        "手机问答：DSH 向用户提问时，手机直接选择选项并提交；",
        "任务详情：时间与来源、子代理数量/深度、费用（无数据时显示“暂无数据”）、按轮次折叠的轨迹；",
        "提醒：任务完成、失败、等待审批/回答时推送，点通知直达任务详情。",
    ]:
        add_bullet(doc, t)
    add_para(doc, "一次完整闭环", size=13, bold=True, color=TEAL, before=10)
    for i, t in enumerate([
        "DSH 创建/运行任务，dsh-watch 捕获事件并写入任务索引；",
        "任务完成/失败或进入等待审批/回答，网关推送手机通知；",
        "用户点通知进入任务详情，看到状态、轨迹和需要处理的卡片；",
        "手机提交允许/拒绝/回答，网关代理到 dsh-watch 审批桥；",
        "DSH 收到决定，任务继续运行或按拒绝结束。",
    ], 1):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        set_run_font(p.add_run(f"{i}. {t}"), size=10.2)
    doc.add_page_break()

    # 04 architecture
    add_chapter(doc, "04", "系统架构")
    add_para(doc, "所有业务数据留在电脑本机；手机只通过设备 token 访问网关的 /v1 接口。公网入口是可选的 cloudflared quick tunnel，不需要自建服务器。", size=10.5)
    doc.add_picture(str(ASSETS / "architecture.png"), width=Cm(16.2))
    add_caption(doc, "图 1  DSH Watch 系统架构：DSH 插件 → 本机网关 → 手机 PWA")
    make_table(doc,
        ["设计选择", "原因"],
        [
            ["本机优先", "任务、日志、SQLite、设备 token 都在电脑；手机只是受控的只读/审批端"],
            ["PWA 而不是原生优先", "零安装成本，iPhone 添加到主屏幕即可获得 Web Push"],
            ["审批桥接而不是改 DSH", "监听 approval/request，waterfall 中保留桌面端原行为"],
            ["设备 token + loopback 管理", "配对接口只允许本机管理；设备 token 只存 sha256"],
        ], widths=[4.0, 12.5])
    doc.add_page_break()

    # 05 milestones
    add_chapter(doc, "05", "从 M0 到 M4")
    make_table(doc,
        ["里程碑", "内容", "状态"],
        [
            ["M0", "真实 DSH 事件、字段、状态判定能力验证", "完成"],
            ["M1", "dsh-watch 插件：事件 → 状态机 → SQLite → /v1 API", "完成，契约 m1-v1.1 冻结"],
            ["M2", "网关 + PWA + Web Push + tunnel", "完成，V06 20/20 到达"],
            ["M3", "SwiftUI 原生签名版（含 M4 审批/问答/轨迹） + GitHub Actions 未签名 IPA", "完成，7 天免费签名维护"],
            ["M4-A", "手机审批（允许/拒绝/conflict/expired）", "完成，隔离环境真机链路通过"],
            ["M4-B", "手机问答（user-questions/request）", "完成，手机回答真机通过"],
            ["M4-C", "轨迹/费用/子代理展示", "完成，PWA 真机验收通过"],
        ], widths=[2.0, 10.0, 4.5])
    add_para(doc, "范围说明：APNs / TestFlight 需要 $99/年 Apple 开发者账号，按零成本约束未纳入本期；M3 的 7 天免费签名属于可选的展示路径。", size=9.5, color=GRAY, before=8)
    add_para(doc, "关键决策", size=13, bold=True, color=TEAL, before=10)
    for t in [
        "先做 PWA 再做原生：先验证 Web Push 和手机审批闭环，避免被证书/账号卡住；",
        "先做旁路桥接再考虑改 DSH：不侵入桌面端 UI，升级 DSH 时风险最低；",
        "先做安全边界再做花哨功能：设备 token、loopback 管理、过期/冲突语义先跑通。",
    ]:
        add_bullet(doc, t)
    doc.add_page_break()

    # 06 screenshots
    add_chapter(doc, "06", "手机端实际体验")
    add_para(doc, "下面两张截图来自真实测试环境：左边是任务详情（轨迹/费用/子代理），右边是手机审批卡。截图只用于项目介绍，不包含凭证或真实用户数据。", size=10.5)
    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    left, right = table.rows[0].cells
    left.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    left.paragraphs[0].add_run().add_picture(str(ROOT / "docs" / "evidence" / "m4" / "m4c-detail.jpg"), width=Cm(7.2))
    right.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    right.paragraphs[0].add_run().add_picture(str(ROOT / "docs" / "evidence" / "m4" / "approval-card.jpg"), width=Cm(7.2))
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run("左：任务详情（轨迹按轮次折叠 / 费用暂无数据 / 子代理）    右：手机审批卡"), size=8.5, color=GRAY)
    add_para(doc, "设计目标是“一眼看懂，少操作”：任务状态在列表页就能分辨；需要人介入时才出现醒目的审批/问答卡；决定后立即回传 DSH，任务继续运行。", size=10.5, before=8)
    doc.add_page_break()

    # 07 engineering
    add_chapter(doc, "07", "工程亮点与安全边界")
    add_para(doc, "1. 不改 DSH，做旁路桥接", size=13, bold=True, color=TEAL)
    add_para(doc, "dsh-watch 通过 Cordis waterfall 监听 approval/request 和 user-questions/request；桌面端原有行为保留，手机只是多一个决定入口。审批桥内置 pending map、桌面/手机竞态处理和过期语义。", size=10.5)
    add_para(doc, "2. 零服务器，但公网可达", size=13, bold=True, color=TEAL, before=8)
    add_para(doc, "本机 gateway 只监听 loopback；需要手机远程访问时，用 cloudflared quick tunnel 把 HTTPS 地址临时映射到本机。tunnel 地址随机、可随时关闭，不申请服务器、不购买域名。", size=10.5)
    add_para(doc, "3. 安全默认值", size=13, bold=True, color=TEAL, before=8)
    for t in [
        "配对管理接口只接受 loopback；配对码 5 分钟、每会话 5 次、按 IP 限速；",
        "设备 token 只存 sha256，不把明文 token 写进数据库；",
        "推送 payload 只含任务引用和通用 kind，不含标题/摘要/路径；",
        "不修改 DSH 源码、不修改原始 session 日志、不读取/写入凭证；",
        "M4 边界测试使用独立 m4-edge profile，不触碰主 profile 的 UI 插件。",
    ]:
        add_bullet(doc, t)
    add_para(doc, "M4 边界验证", size=13, bold=True, color=TEAL, before=10)
    make_table(doc,
        ["场景", "结果"],
        [
            ["手机拒绝", "decided / mobile / rejected；probe 文件不存在"],
            ["桌面先允许 → 手机 conflict", "手机提交 HTTP 409；日志仅 1 行"],
            ["插件重启 → 旧 pending", "旧 action HTTP 410 expired；不补执行"],
        ], widths=[5.0, 11.5])
    doc.add_page_break()

    # 08 acceptance
    add_chapter(doc, "08", "验收数据")
    make_table(doc,
        ["项目", "证据 / 结果"],
        [
            ["测试", "npm test：71 / 71 通过（M1 + M2 + M4）"],
            ["M1 契约", "m1-v1.1 冻结，42 项测试，13 份回归样本"],
            ["M2 推送", "iPhone 17 Pro Max 真机 V06：20 / 20 到达（100%）"],
            ["M4-A 审批", "手机允许 → decided / mobile / allowed-once；拒绝、conflict、expired 均通过"],
            ["M4-B 问答", "q_e400daad… → decision=mobile / status=answered"],
            ["M4-C 展示", "轨迹折叠 / 费用“暂无数据” / 子代理信息真机通过"],
            ["隔离边界", "手机拒绝 act_30113e39…；conflict act_8cbf995b…；expired act_1e78a4ba…"],
        ], widths=[4.0, 12.5])
    add_para(doc, "详细证据位于 dsh-mobile-watch/docs/evidence/ 与 docs/M4-A-REPORT.md、docs/M4-B-REPORT.md、docs/M4-C-REPORT.md。", size=9.5, color=GRAY, before=8)
    doc.add_page_break()

    # 09 deploy
    add_chapter(doc, "09", "部署与使用")
    add_para(doc, "面向朋友的安装路径已经做到“双击两次”：", size=10.5)
    make_table(doc,
        ["步骤", "操作", "结果"],
        [
            ["0", "安装 Node.js 24 LTS 和 DSH Desktop", "前置环境"],
            ["1", "双击 install.cmd", "自动安装网关依赖、跑测试、安装 dsh-watch 插件"],
            ["2", "重启 DSH Desktop", "插件加载"],
            ["3", "双击 start-dsh-watch.cmd", "启动网关、cloudflared、手机配对"],
            ["4", "iPhone Safari 打开 tunnel 地址 → 添加到主屏幕 → 输入配对码", "开始使用"],
        ], widths=[1.5, 9.5, 5.5])
    add_para(doc, "装好后的日常使用见 docs/USER-GUIDE.md；完整部署细节见 docs/DEPLOYMENT.md；给 AI 代理的部署说明见 docs/AI-DEPLOY.md。", size=9.5, color=GRAY, before=8)
    add_para(doc, "部署后检查清单", size=13, bold=True, color=TEAL, before=10)
    for t in [
        "7317 health：ok=true，capabilities.approval=true；",
        "8787 health：ok=true，upstream.ok=true；",
        "PWA 能从主屏幕打开，配对后能看到任务；",
        "设置页开启通知，gateway subscriptions ≥ 1；",
        "手机审批允许一次后，DSH 任务恢复运行。",
    ]:
        add_bullet(doc, t)
    add_para(doc, "仓库地址：https://github.com/sunnyhuang236/DSH_Watch", size=10.5, bold=True, color=TEAL, before=8)
    doc.add_page_break()

    # 10 status
    add_chapter(doc, "10", "当前状态与后续")
    add_para(doc, "当前状态：M0–M4 核心完成，代码、文档、部署入口和 GitHub 仓库已经整理好。", size=11, bold=True, color=TEAL)
    add_para(doc, "已完成的核心闭环：任务状态 → 手机通知 → 任务详情 → 手机审批/问答 → DSH 继续执行。", size=10.5)
    add_para(doc, "可选增强（不影响当前使用）", size=13, bold=True, color=TEAL, before=10)
    for t in [
        "APNs / TestFlight：需要 $99/年 Apple 开发者账号，当前零成本约束下不做；",
        "Live Activity：iOS 锁屏/灵动岛常驻卡片，需原生 ActivityKit + APNs，属于演示增强；",
        "M3 免费签名：7 天到期后重新用 Sideloadly 签名；",
        "多设备/多电脑：当前以单电脑 + 单手机为主，后续可扩展设备管理。",
    ]:
        add_bullet(doc, t)
    add_para(doc, "项目定位：这不是要替代 DSH Desktop，而是补上“人离开电脑后”的那一段时间。", size=10.5, color=TEAL, bold=True, before=10)
    doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run("DSH Watch · 让长任务不再需要人守着"), size=12, bold=True, color=NAVY)

    out = ROOT / "docs" / "DSH-Watch-项目介绍.docx"
    doc.save(out)
    print(out)


if __name__ == "__main__":
    make_doc()
