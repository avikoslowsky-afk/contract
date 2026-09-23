import re
import sys
import zipfile
import xml.etree.ElementTree as ET


NAMESPACES = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
}


def node_text(node):
    parts = []
    for child in node.iter():
        if child.tag == f"{{{NAMESPACES['w']}}}t":
            parts.append(child.text or "")
        elif child.tag == f"{{{NAMESPACES['w']}}}tab":
            parts.append("\t")
        elif child.tag == f"{{{NAMESPACES['w']}}}br":
            parts.append("\n")
    return "".join(parts).strip()


def extract_xml_text(zf, name):
    try:
        raw = zf.read(name)
    except KeyError:
        return []
    root = ET.fromstring(raw)
    lines = []
    for paragraph in root.findall(".//w:p", NAMESPACES):
        text = node_text(paragraph)
        if text:
            lines.append(text)
    for table in root.findall(".//w:tbl", NAMESPACES):
        for row in table.findall(".//w:tr", NAMESPACES):
            cells = [node_text(cell) for cell in row.findall(".//w:tc", NAMESPACES)]
            cells = [cell for cell in cells if cell]
            if cells:
                lines.append(" | ".join(cells))
    return lines


def clean_text(lines):
    text = "\n".join(lines)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def main():
    if len(sys.argv) < 2:
        print("Usage: docx_to_text.py path.docx", file=sys.stderr)
        return 2
    docx_path = sys.argv[1]
    lines = []
    with zipfile.ZipFile(docx_path) as zf:
        lines.extend(extract_xml_text(zf, "word/document.xml"))
        for name in sorted(zf.namelist()):
            if name.startswith("word/header") and name.endswith(".xml"):
                lines.extend(extract_xml_text(zf, name))
            if name.startswith("word/footer") and name.endswith(".xml"):
                lines.extend(extract_xml_text(zf, name))
    text = clean_text(lines)
    if not text:
        print("No readable Word text found.", file=sys.stderr)
        return 1
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
