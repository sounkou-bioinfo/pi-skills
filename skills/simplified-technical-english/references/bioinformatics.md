# STE for bioinformatics

ASD-STE100 comes from the aerospace industry.
Its rules for sentences, verbs, and punctuation apply to bioinformatics text without change.
Only the technical names, the technical verbs, and the safety instructions are different.
This file gives those differences.
This file is an addition to the skill. It is not a part of the specification.

## Part 1: Where to apply STE

Apply STE to these types of bioinformatics text:

- Procedures for a pipeline, a workflow, or a laboratory protocol
- Installation instructions and instructions for the operation of a tool
- The methods section of a report
- Descriptions of file formats, data models, and results
- Error messages and log messages of your software.

Do not change text that is data.
Sequences, identifiers, gene symbols, commands, file paths, and quoted output stay as they are.

## Part 2: Technical names

Rule 1.5 permits a word that is in a technical name category.
These categories apply to bioinformatics:

| Category of rule 1.5 | Bioinformatics examples |
|---|---|
| 3. Tools and support equipment | sequencer, flowcell, aligner, variant caller, container |
| 4. Materials | library, primer, adapter, probe, reagent |
| 6. Systems, components, and their functions | pipeline, workflow, index, header, record, field |
| 7. Mathematical and scientific terms | genome, allele, haplotype, coverage, median, p-value |
| 9. Numbers and units of measurement | 30x, 150 bp, 2 Mb, 0.05 |
| 11. Persons, groups, and organizations | cohort, proband, analyst, NCBI, EMBL-EBI |
| 12. Parts of the body | liver, blood, tissue |
| 14. Medical terms | tumor, carrier, pathogenic variant |
| 15. Official documents | protocol, manifest, release notes, VCF specification |
| 18. Damage terms | artifact, contamination, truncated file, batch effect |
| 19. Information technology terms | file, directory, database, script, thread, checksum |

The approved technical names of this skill are in `bioinformatics-terms.md`.
The `ste_check` tool accepts those names.
You can add the names of your project to that list.

Rules for technical names in bioinformatics:

- Write an official name exactly as its owner writes it. Examples: `BRCA1`, `samtools`, `GRCh38`, `ENSG00000139618`.
- Use the nomenclature of the applicable authority. For human genes, use HGNC symbols. For variants, use HGVS names.
- Use one name for one item (rule 1.11). Do not change between "variant", "mutation", and "SNP" for the same item.
- Do not change between "sample", "specimen", and "library". These are three different items.
- Do not use a tool name as a verb (rule 1.7). Write "Do a BLAST search for the sequence", not "BLAST the sequence".
- Do not use slang (rule 1.10). Do not write "munge", "wrangle", "crunch", or "nuke".
- Give a name its definition when you use it for the first time, if the reader possibly does not know it.

Some words have a different function in bioinformatics:

| Word | In the STE dictionary | In bioinformatics text |
|---|---|---|
| read | verb only | Also a technical name: "the reads of the sample" |
| sequence | noun only | Also a technical verb: "sequence the library" |
| index, filter, cluster | not approved | Technical name and technical verb |
| base | not approved | Technical name for a nucleotide. For the bottom of an item, write "bottom". |
| upstream, downstream | not approved | Technical names for a position on a strand. For the order of steps, write "before" and "after". |
| coverage | not approved | Technical name. Give the value and the unit. |

## Part 3: Technical verbs

Rule 1.12 permits a technical verb when no approved verb is sufficient.
Category 2 (computer processes) and category 1 (processes of the subject) apply.
The technical verbs of this skill are in `bioinformatics-terms.md`.
Examples: map, call, sequence, assemble, annotate, index, sort, filter, merge, trim, phase, impute, normalize.

Rules for technical verbs in bioinformatics:

- Use an approved verb if one is available. Write "find", not "detect". Write "calculate", not "compute". Write "use", not "leverage".
- Write "do a check of", not "validate", when the check has no formal specification.
- The past participle of a technical verb is permitted as an adjective. Examples: "the sorted file", "the phased variants".
- An "-ing" form is permitted only as a technical name. Examples: "sequencing run", "variant calling", "mapping quality".
- If a command is possible, use the verb. Write "Call the variants", not "Do the variant calling".

## Part 4: Specific values

STE does not permit vague words. Bioinformatics text has many of them.
Replace each vague statement with the value, the unit, and the method.

| Not STE | STE |
|---|---|
| high coverage | a mean depth of 30x |
| a significant difference | a difference with an adjusted p-value less than 0.05 (Wald test) |
| low-quality reads | reads with a mean base quality less than 20 |
| a recent version of samtools | samtools 1.21 or a later version |
| the human reference | the reference genome GRCh38 (GENCODE release 46) |
| rare variants | variants with an allele frequency less than 0.01 in gnomAD 4.1 |
| a large file | a file larger than 50 GB |
| robust, novel, state-of-the-art | Remove the word, or give the evidence. |

Rules for values:

- Give the reference build with each genomic coordinate. Example: `chr7:140753336 (GRCh38)`.
- Tell the reader if the coordinates start at 0 or at 1, and if the end is included.
- Give the version of each tool and each database.
- Give the unit with each number. Write "150 bp", "2.5 Gb", "16 threads", "64 GB of memory".
- Give the exact command and its parameters in a code block.

## Part 5: Safety instructions

Rule 7.1 tells you to show the level of risk. In bioinformatics, use these levels:

- **WARNING**: a risk to persons. Examples: a result that a clinician will use for a decision, the release of personal genetic data, a hazard in the laboratory.
- **CAUTION**: a risk of damage to data or results. Examples: a command that deletes files, a result from the incorrect reference build, a sample swap.
- **NOTE**: information that helps the reader, without a risk.

Start with the command or the condition. Then give the risk.

> CAUTION: Do not sort the BAM file in the input directory. The command replaces the input file, and you cannot get the data back.

> WARNING: Do not send the VCF file out of the secure environment. The file contains genetic data that can identify a person.

## Part 6: Replacements for frequent words

| Not STE | STE |
|---|---|
| perform alignment of the reads | align the reads |
| run the samples through the pipeline | start the pipeline for the samples |
| the data was processed | Name the tool: "fastp removed the adapters" |
| downstream analysis | the subsequent analysis, or the name of the step |
| in silico | with a computer, or the name of the method |
| QC the data | do a quality check of the data |
| subset the file | select the applicable records from the file |
| lift over the coordinates | convert the coordinates to the other build |
| a pipeline crash | a failure of the pipeline |
| sanity check | check |
| on the fly | during the operation |
| we leverage, we utilize | we use |
