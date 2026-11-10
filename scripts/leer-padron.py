"""Lee los listados Excel y entrega las filas al importador por stdout privado."""
import json
import sys
from pathlib import Path
from openpyxl import load_workbook

root = Path(sys.argv[1])
students = []
for grade in range(1, 6):
    files = sorted((root / f"{grade} GRADO").glob("*.xlsx"))
    if not files:
        raise SystemExit(f"No hay archivos en la carpeta de grado {grade}.")
    for file in files:
        if file.name.startswith("~$"):
            continue
        expected_grade, section = file.stem.split()
        if int(expected_grade) != grade or section not in "ABCDEFGH":
            raise SystemExit(f"Archivo inesperado en grado {grade}.")
        book = load_workbook(file, read_only=True, data_only=True)
        try:
            sheet = book["rptListadoEstudiantes"]
            if sheet["D12"].value != "NÚMERO DE DOCUMENTO" or sheet["P12"].value != "NOMBRES":
                raise SystemExit(f"Encabezados inesperados en {file.name}.")
            for row in sheet.iter_rows(min_row=13, max_col=28, values_only=True):
                if not any(row[i] for i in (2, 3, 8, 10, 12, 15)):
                    continue
                def value(index):
                    return str(row[index]).strip() if row[index] is not None else ""
                students.append({
                    "grado": grade, "seccion": section, "item": row[1],
                    "tipoDocumento": value(2), "numeroDocumento": value(3),
                    "validadoReniec": value(7), "codigoEstudiante": value(8),
                    "names": {"nombres": value(15), "apellidoPaterno": value(10), "apellidoMaterno": value(12)},
                    "sexo": value(20), "fechaNacimiento": value(24), "edadAl31DeMarzo": row[25],
                    "matricula": value(26), "tipoVacante": value(27),
                })
        finally:
            book.close()

print(json.dumps(students, default=str))
