import { IsNumber, IsPositive, IsString, Min } from 'class-validator';

export class CreateCycleDto {
  @IsString() userId!: string;
  @IsNumber() @IsPositive() initialAmount!: number;
  @IsNumber() @Min(1) targetAmount!: number;
}

export class RegisterBetDto {
  @IsString() matchId!: string;
  @IsString() market!: string;
  @IsNumber() @IsPositive() odd!: number;
  @IsNumber() @IsPositive() stake!: number;
}
