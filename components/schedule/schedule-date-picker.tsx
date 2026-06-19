"use client"

import * as React from "react"
import { CalendarDays, ChevronDown, Clock, Check, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useActiveOrg } from "@/components/active-org-provider"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { format, startOfDay, addMinutes, isSameDay, isBefore } from "date-fns"
import { ptBR } from "date-fns/locale"

interface ScheduleDatePickerProps {
  date: Date | undefined
  setDate: (date: Date | undefined) => void
  time: string
  setTime: (time: string) => void
  className?: string
  align?: "start" | "center" | "end"
  renderButton?: (isDatePassed: boolean, isTimeNotAvailable: boolean) => React.ReactNode
}


const generateTimeOptions = () => {
  const options: string[] = []
  const baseDate = startOfDay(new Date())
  for (let i = 0; i < 24 * 4; i++) {
    options.push(format(addMinutes(baseDate, i * 15), "h:mm a"))
  }
  return options
}

const timeOptions = generateTimeOptions()



export function ScheduleDatePicker({
  date,
  setDate,
  time,
  setTime,
  className,
  align = "end",
  renderButton
}: ScheduleDatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const today = React.useMemo(() => startOfDay(new Date()), [])
  const { activeOrgId } = useActiveOrg()

  // Melhores horários sugeridos (heurística + histórico da org).
  const { data: bestTimes } = useQuery({
    queryKey: ["best-times", activeOrgId],
    queryFn: async () => {
      const res = await fetch("/api/best-times")
      return res.json() as Promise<{
        perChannel: { slots: { day: number; hour: number }[] }[]
        personalized: { day: number; hour: number }[]
      }>
    },
  })

  // Preenche data+hora com o PRÓXIMO melhor slot a partir de agora.
  const applyBestTime = React.useCallback(() => {
    const slots = [
      ...(bestTimes?.personalized ?? []),
      ...(bestTimes?.perChannel ?? []).flatMap((c) => c.slots),
    ]
    if (slots.length === 0) return
    const now = new Date()
    let best: Date | null = null
    // Procura o próximo (dia da semana, hora) que cai no futuro, nos próximos 7 dias.
    for (let addDays = 0; addDays < 8 && !best; addDays++) {
      const candidate = new Date(now)
      candidate.setDate(now.getDate() + addDays)
      const dow = candidate.getDay()
      const hoursForDay = slots
        .filter((s) => s.day === dow)
        .map((s) => s.hour)
        .sort((a, b) => a - b)
      for (const h of hoursForDay) {
        const dt = new Date(candidate)
        dt.setHours(h, 0, 0, 0)
        if (dt > now) {
          best = dt
          break
        }
      }
    }
    if (!best) return
    setDate(startOfDay(best))
    setTime(format(best, "h:mm a"))
  }, [bestTimes, setDate, setTime])


  const availableTimeOptions = React.useMemo(() => {
    if (!date || !isSameDay(date, new Date())) return timeOptions
    const now = new Date()
    return timeOptions.filter((slot) => {
      const [timeValue, meridiem] = slot.split(" ")
      const [rawHour, rawMinute] = timeValue.split(":").map(Number)
      // hour - 
      const hour = meridiem === "PM" && rawHour !== 12 ? rawHour + 12 : meridiem === "AM" && rawHour === 12 ? 0 : rawHour
      const candidate = new Date(date)
      candidate.setHours(hour, rawMinute, 0, 0)
      return !isBefore(candidate, now)
    })
  }, [date])

  React.useEffect(() => {
    if (!time && availableTimeOptions.length > 0) {
      setTime(availableTimeOptions[0])
      return
    }
    if (time) {
      setTime(time)
    }
  }, [availableTimeOptions, setTime, time])

  const isDatePassed = date ? isBefore(date, new Date()) && !isSameDay(date, new Date()) : false
  const isTimeNotAvailable = time ? !availableTimeOptions.includes(time) : false

  const handleTimeChange = (newTime: string) => {
    setTime(newTime)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="lg" className={cn("px-4", className)} variant="outline">
            <span className="flex-1 flex items-center gap-2 text-sm">
              <CalendarDays className="size-4" />
              <span className="flex items-center gap-1.5 font-semibold">
                {date ? format(date, "d 'de' MMMM", { locale: ptBR }) : "Definir data e hora"}
                {date && time && <span className="text-muted-foreground">, {time}</span>}
              </span>
            </span>
            <ChevronDown className="size-4!" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align={align}>
          <div className="w-full p-4 space-y-6">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              disabled={{ before: today }}
              className="p-0 w-full"
              formatters={{
                formatWeekdayName: (date) => date.toLocaleDateString('pt-BR', { weekday: 'narrow' })
              }}
              classNames={{
                month_caption: "flex justify-start items-center h-9 ml-2",
                caption_label: "text-base font-semibold",
                nav: "absolute right-2 top-0 flex items-center gap-1",
                month: "space-y-4 w-full",
                // table: "w-full border-collapse space-y-1",
                // head_row: "flex w-full justify-between",
                // head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
                // row: "flex w-full mt-2 justify-between",
                // cell: "text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
                day: cn(
                  "h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-lg hover:bg-muted transition-colors"
                ),
                // day_selected: "bg-primary! text-primary-foreground! hover:bg-primary! hover:text-primary-foreground! rounded-lg",
                // day_today: "bg-muted text-foreground",
                // day_outside: "text-muted-foreground opacity-50",
                // day_disabled: "text-muted-foreground opacity-50",
                // day_hidden: "invisible",
              }}
            />

            <div className="space-y-1">
              <h4 className="text-[13px] font-semibold text-foreground/70">Selecionar horário</h4>
              <div className="flex items-center gap-2">
                <Select value={time} onValueChange={handleTimeChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecionar horário" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-[200px]">
                    {availableTimeOptions.map((time) => (
                      <SelectItem key={time} value={time}>
                        <Clock className="size-3" />
                        {time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 w-full justify-start gap-2 text-primary hover:text-primary"
                onClick={applyBestTime}
              >
                <Sparkles className="size-3.5" />
                Usar melhor horário sugerido
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-end p-4 border-t bg-muted/5">
            <Button size="lg" className="" onClick={() => setOpen(false)}>
              <Check className="size-4" />
              Concluir
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {renderButton && renderButton(isDatePassed, isTimeNotAvailable)
      }
    </>
  )
}
