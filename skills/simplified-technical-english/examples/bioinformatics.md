# Examples: bioinformatics text before and after

This file shows bioinformatics text before and after the change to STE.
The examples are an addition to the skill. They are not from the specification.

## Example 1: Pipeline procedure

Before:

> Prior to running the variant calling step, the BAM files should be
> coordinate-sorted and indexed; failing to do so may cause the caller to
> crash or silently produce incomplete output.

After:

> 1. Sort each BAM file by coordinate.
> 2. Index each sorted BAM file.
> 3. Call the variants.
>
> CAUTION: Do not call the variants from a BAM file that has no index.
> The variant caller can stop, or the output can be incomplete.

The change: one command in each step, no "-ing" verb forms, no "should", and a caution for the risk to the results.

## Example 2: Methods section

Before:

> Reads were aligned to the human reference using BWA-MEM with default
> parameters, after which duplicates were marked and high-quality variants
> were called using a state-of-the-art deep learning approach.

After:

> We aligned the reads to the reference genome GRCh38 with BWA-MEM 0.7.18 and its default parameters.
> Picard 3.2.0 marked the duplicate reads.
> DeepVariant 1.6.1 called the variants.
> We kept the variants that had a genotype quality of 20 or more.

The change: active voice with an agent, the simple past tense, the version of each tool, and a value in the place of "high-quality".

## Example 3: Description of a result

Before:

> Coverage was generally good across the exome, though some GC-rich regions
> were found to be significantly under-covered, which might be impacting
> sensitivity in those areas.

After:

> The mean depth of the exome is 112x.
> In 95.4% of the target bases, the depth is 30x or more.
> In 1,208 target regions, the mean depth is less than 20x.
> These regions have a GC content of more than 70%.
> In these regions, the sensitivity for variants can be low.

The change: values in the place of "good" and "significantly", one topic in each sentence, "can" in the place of "might".

## Example 4: Warning about data

Before:

> Users should be very careful when sharing output files, as they may contain
> information that could potentially be used to re-identify participants.

After:

> WARNING: Do not send the VCF files out of the secure environment.
> The files contain genetic data that can identify a participant.

The change: a command comes first, then the risk. "WARNING" shows that the risk is to persons.

## Example 5: Error message

Before:

> Oops! Something went wrong while trying to parse your file, it might be
> corrupted or in an unsupported format.

After:

> Error: `sample1.vcf.gz` has no VCF header.
> Make sure that the file is a VCF file with bgzip compression.

The change: the specific cause, the name of the file, and a command that tells the reader what to do.
